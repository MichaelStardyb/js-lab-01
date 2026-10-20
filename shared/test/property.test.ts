import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  encodeInput,
  decodeInput,
  encodeSnapshot,
  decodeSnapshot,
  PROTOCOL_VERSION,
  INPUT_MESSAGE_TYPE,
  SNAPSHOT_MESSAGE_TYPE,
  INPUT_PACKET_BYTES,
  SNAPSHOT_HEADER_BYTES,
  SNAPSHOT_ENTITY_BYTES,
  SHIP_KIND,
  BULLET_KIND,
  ASTEROID_KIND,
  PICKUP_KIND,
} from '../protocol/binaryCodec.js';
import { integrate, type ShipState, type ShipInput } from '../sim/ship.js';
import { DEFAULT_ARENA } from '../sim/arena.js';
import { parseClientMessage } from '../protocol/schema.js';

describe('shared fast-check property tests', () => {
  // Property 1: Roundtrip codec within angle quantization tolerance
  it('Property 1: decode(encode(snapshot)) roundtrips with angle quantization tolerance <= 0.00015 rad', () => {
    const entityArb = fc.record({
      id: fc.integer({ min: 1, max: 65535 }),
      kind: fc.constantFrom(SHIP_KIND, BULLET_KIND, ASTEROID_KIND, PICKUP_KIND),
      x: fc.double({ min: 0, max: 800, noNaN: true }),
      y: fc.double({ min: 0, max: 600, noNaN: true }),
      angle: fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
      vx: fc.integer({ min: -500, max: 500 }),
      vy: fc.integer({ min: -500, max: 500 }),
      hp: fc.integer({ min: 0, max: 100 }),
    });

    const snapshotArb = fc.record({
      tick: fc.integer({ min: 0, max: 0xFFFFFFFF }),
      lastProcessedSeq: fc.integer({ min: 0, max: 0xFFFFFFFF }),
      entities: fc.array(entityArb, { maxLength: 20 }),
    });

    fc.assert(
      fc.property(snapshotArb, (snapshot) => {
        const encoded = encodeSnapshot(snapshot);
        const decoded = decodeSnapshot(encoded);

        expect(decoded.tick).toBe(snapshot.tick);
        expect(decoded.lastProcessedSeq).toBe(snapshot.lastProcessedSeq);
        expect(decoded.entities.length).toBe(snapshot.entities.length);

        for (let i = 0; i < snapshot.entities.length; i++) {
          const orig = snapshot.entities[i]!;
          const dec = decoded.entities[i]!;

          expect(dec.id).toBe(orig.id);
          expect(dec.kind).toBe(orig.kind);
          expect(dec.x).toBeCloseTo(orig.x, 2);
          expect(dec.y).toBeCloseTo(orig.y, 2);
          expect(dec.vx).toBe(orig.vx);
          expect(dec.vy).toBe(orig.vy);
          expect(dec.hp).toBe(orig.hp);

          // Angle quantization tolerance derived from Int16 scale: Math.round(angle * 10000) / 10000
          const angleDelta = Math.atan2(Math.sin(dec.angle - orig.angle), Math.cos(dec.angle - orig.angle));
          expect(Math.abs(angleDelta)).toBeLessThanOrEqual(0.00015);
        }
      }),
      { numRuns: 100, seed: 12345 }
    );
  });

  // Property 2: Frame length matches format specification
  it('Property 2: frame byteLength matches exact formula 12 + N*18 for snapshots and 7 for input', () => {
    const inputArb = fc.record({
      v: fc.constant(1 as const),
      type: fc.constant('input' as const),
      seq: fc.integer({ min: 0, max: 0xFFFFFFFF }),
      thrust: fc.boolean(),
      turnLeft: fc.boolean(),
      turnRight: fc.boolean(),
      fire: fc.boolean(),
    });

    fc.assert(
      fc.property(inputArb, (input) => {
        const encoded = encodeInput(input);
        expect(encoded.byteLength).toBe(INPUT_PACKET_BYTES);
      }),
      { numRuns: 50 }
    );

    const entitiesArb = fc.array(
      fc.record({
        id: fc.integer({ min: 1, max: 65535 }),
        kind: fc.constantFrom(SHIP_KIND, BULLET_KIND, ASTEROID_KIND, PICKUP_KIND),
        x: fc.double({ min: 0, max: 800, noNaN: true }),
        y: fc.double({ min: 0, max: 600, noNaN: true }),
        angle: fc.double({ min: 0, max: 6.28, noNaN: true }),
        vx: fc.integer({ min: -100, max: 100 }),
        vy: fc.integer({ min: -100, max: 100 }),
      }),
      { maxLength: 50 }
    );

    fc.assert(
      fc.property(entitiesArb, (entities) => {
        const encoded = encodeSnapshot({
          tick: 1,
          lastProcessedSeq: 1,
          entities,
        });
        const expectedBytes = SNAPSHOT_HEADER_BYTES + entities.length * SNAPSHOT_ENTITY_BYTES;
        expect(encoded.byteLength).toBe(expectedBytes);
      }),
      { numRuns: 50 }
    );
  });

  // Property 3: Arbitrary / corrupted buffer -> decoder throws controlled error, never crashes uncaught
  it('Property 3: corrupted or arbitrary buffers throw controlled Error or RangeError without unhandled crash', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 500 }), (rawBytes) => {
        try {
          decodeInput(rawBytes.buffer);
        } catch (err: unknown) {
          expect(err instanceof Error || err instanceof RangeError || err instanceof TypeError).toBe(true);
        }

        try {
          decodeSnapshot(rawBytes.buffer);
        } catch (err: unknown) {
          expect(err instanceof Error || err instanceof RangeError || err instanceof TypeError).toBe(true);
        }
      }),
      { numRuns: 200, seed: 9999 }
    );
  });

  // Property 4: Ship remains within arena boundaries after arbitrary sequence of inputs
  it('Property 4: ship position remains within arena bounds [0, width) and [0, height) for arbitrary inputs', () => {
    const inputSequenceArb = fc.array(
      fc.record({
        thrust: fc.boolean(),
        turnLeft: fc.boolean(),
        turnRight: fc.boolean(),
      }),
      { minLength: 1, maxLength: 100 }
    );

    fc.assert(
      fc.property(inputSequenceArb, (inputs) => {
        let ship: ShipState = { x: 400, y: 300, vx: 0, vy: 0, angle: 0 };
        for (const inp of inputs) {
          ship = integrate(ship, inp, 1 / 30, DEFAULT_ARENA);
          expect(ship.x).toBeGreaterThanOrEqual(0);
          expect(ship.x).toBeLessThan(DEFAULT_ARENA.width);
          expect(ship.y).toBeGreaterThanOrEqual(0);
          expect(ship.y).toBeLessThan(DEFAULT_ARENA.height);
          expect(Number.isFinite(ship.vx)).toBe(true);
          expect(Number.isFinite(ship.vy)).toBe(true);
          expect(Number.isFinite(ship.angle)).toBe(true);
        }
      }),
      { numRuns: 100, seed: 777 }
    );
  });

  // Property 5: parseClientMessage accepts valid schemas and rejects corrupted inputs
  it('Property 5: parseClientMessage accepts valid messages and rejects corrupted ones safely', () => {
    const validChatArb = fc.record({
      v: fc.constant(0 as const),
      type: fc.constant('chat' as const),
      text: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => /^[^\u0000-\u001f\u007f]+$/u.test(s)),
    });

    fc.assert(
      fc.property(validChatArb, (chat) => {
        const result = parseClientMessage(chat);
        expect('value' in result).toBe(true);
        if ('value' in result) {
          expect(result.value).toEqual(chat);
        }
      }),
      { numRuns: 50 }
    );

    const corruptedArb = fc.record({
      v: fc.integer({ min: -10, max: 10 }),
      type: fc.string({ minLength: 1, maxLength: 20 }),
      extra: fc.anything(),
    }).filter((obj) => obj.type !== 'join' && obj.type !== 'chat' && obj.type !== 'leave' && obj.type !== 'input' && obj.type !== 'ping');

    fc.assert(
      fc.property(corruptedArb, (corrupted) => {
        const result = parseClientMessage(corrupted);
        expect('error' in result).toBe(true);
      }),
      { numRuns: 50 }
    );
  });
});
