import { describe, it, expect } from 'vitest';
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

describe('shared/protocol/binaryCodec', () => {
  describe('encodeInput and decodeInput', () => {
    it('round-trips input packets with 7-byte little-endian format', () => {
      const input = {
        v: 1 as const,
        type: 'input' as const,
        seq: 0x12345678,
        thrust: true,
        turnLeft: false,
        turnRight: true,
        fire: true,
      };
      const encoded = encodeInput(input);
      expect(encoded.byteLength).toBe(INPUT_PACKET_BYTES);
      const bytes = new Uint8Array(encoded);
      expect(bytes[0]).toBe(PROTOCOL_VERSION);
      expect(bytes[1]).toBe(INPUT_MESSAGE_TYPE);
      // Little-endian seq
      expect(bytes[2]).toBe(0x78);
      expect(bytes[3]).toBe(0x56);
      expect(bytes[4]).toBe(0x34);
      expect(bytes[5]).toBe(0x12);
      // Flags: thrust (1) | turnRight (4) | fire (8) = 13
      expect(bytes[6]).toBe(13);

      const decoded = decodeInput(encoded);
      expect(decoded).toEqual({
        type: 'input',
        seq: input.seq,
        thrust: true,
        turnLeft: false,
        turnRight: true,
        fire: true,
      });
    });

    it('handles all flag combinations correctly', () => {
      const allFalse = encodeInput({ v: 1, type: 'input', seq: 1, thrust: false, turnLeft: false, turnRight: false, fire: false });
      expect(new Uint8Array(allFalse)[6]).toBe(0);
      expect(decodeInput(allFalse)).toMatchObject({ thrust: false, turnLeft: false, turnRight: false, fire: false });

      const allTrue = encodeInput({ v: 1, type: 'input', seq: 2, thrust: true, turnLeft: true, turnRight: true, fire: true });
      expect(new Uint8Array(allTrue)[6]).toBe(15);
      expect(decodeInput(allTrue)).toMatchObject({ thrust: true, turnLeft: true, turnRight: true, fire: true });
    });

    it('rejects packets with incorrect byteLength', () => {
      expect(() => decodeInput(new ArrayBuffer(6))).toThrow(RangeError);
      expect(() => decodeInput(new ArrayBuffer(8))).toThrow(RangeError);
    });

    it('rejects packet with invalid protocol version or message type', () => {
      const badVersion = new Uint8Array([99, INPUT_MESSAGE_TYPE, 0, 0, 0, 0, 0]);
      expect(() => decodeInput(badVersion.buffer)).toThrow(/unsupported/);

      const badType = new Uint8Array([PROTOCOL_VERSION, 99, 0, 0, 0, 0, 0]);
      expect(() => decodeInput(badType.buffer)).toThrow(/unsupported/);
    });

    it('rejects input packet with unknown flag bits set', () => {
      const badFlags = new Uint8Array([PROTOCOL_VERSION, INPUT_MESSAGE_TYPE, 0, 0, 0, 0, 0b10000000]);
      expect(() => decodeInput(badFlags.buffer)).toThrow(/unknown flags/);
    });
  });

  describe('encodeSnapshot and decodeSnapshot', () => {
    it('round-trips snapshot packets with documented header and entity size', () => {
      const snapshot = {
        tick: 1234,
        lastProcessedSeq: 998,
        entities: [
          { id: 8, kind: SHIP_KIND, x: 12.5, y: 99.25, angle: 1.5, vx: -100, vy: 140, hp: 85 },
        ],
      };
      const encoded = encodeSnapshot(snapshot);
      expect(encoded.byteLength).toBe(SNAPSHOT_HEADER_BYTES + SNAPSHOT_ENTITY_BYTES);

      const decoded = decodeSnapshot(encoded);
      expect(decoded.tick).toBe(snapshot.tick);
      expect(decoded.lastProcessedSeq).toBe(snapshot.lastProcessedSeq);
      expect(decoded.entities.length).toBe(1);

      const entity = decoded.entities[0]!;
      expect(entity.id).toBe(8);
      expect(entity.kind).toBe(SHIP_KIND);
      expect(entity.x).toBeCloseTo(12.5, 3);
      expect(entity.y).toBeCloseTo(99.25, 3);
      expect(entity.vx).toBe(-100);
      expect(entity.vy).toBe(140);
      expect(entity.hp).toBe(85);
      expect(entity.angle).toBeCloseTo(1.5, 3);
    });

    it('quantizes angle with scale 10000 into Int16', () => {
      const snapshot = {
        tick: 1,
        lastProcessedSeq: 1,
        entities: [
          { id: 1, kind: SHIP_KIND, x: 0, y: 0, angle: 2.34567, vx: 0, vy: 0, hp: 100 },
        ],
      };
      const decoded = decodeSnapshot(encodeSnapshot(snapshot));
      expect(Math.abs(decoded.entities[0]!.angle - 2.34567)).toBeLessThan(0.0001);
    });

    it('encodes and decodes multi-entity snapshots for all kinds', () => {
      const multi = {
        tick: 50,
        lastProcessedSeq: 20,
        entities: [
          { id: 1, kind: SHIP_KIND, x: 100, y: 150, angle: 1.2, vx: 10, vy: 20, hp: 100 },
          { id: 2, kind: BULLET_KIND, x: 200, y: 250, angle: 0.5, vx: 300, vy: 0, hp: 1 },
          { id: 3, kind: ASTEROID_KIND, x: 300, y: 350, angle: 2.1, vx: -15, vy: 15, hp: 25 },
          { id: 4, kind: PICKUP_KIND, x: 400, y: 450, angle: 0, vx: 0, vy: 0, hp: 50 },
        ],
      };
      const encoded = encodeSnapshot(multi);
      expect(encoded.byteLength).toBe(SNAPSHOT_HEADER_BYTES + 4 * SNAPSHOT_ENTITY_BYTES);

      const decoded = decodeSnapshot(encoded);
      expect(decoded.entities.length).toBe(4);
      expect(decoded.entities[0]?.kind).toBe(SHIP_KIND);
      expect(decoded.entities[1]?.kind).toBe(BULLET_KIND);
      expect(decoded.entities[2]?.kind).toBe(ASTEROID_KIND);
      expect(decoded.entities[3]?.kind).toBe(PICKUP_KIND);
    });

    it('rejects snapshots with non-finite coordinates', () => {
      expect(() => encodeSnapshot({
        tick: 0,
        lastProcessedSeq: 0,
        entities: [{ id: 1, kind: 1, x: NaN, y: 0, angle: 0, vx: 0, vy: 0 }],
      })).toThrow(/finite numbers/);

      expect(() => encodeSnapshot({
        tick: 0,
        lastProcessedSeq: 0,
        entities: [{ id: 1, kind: 1, x: 0, y: Infinity, angle: 0, vx: 0, vy: 0 }],
      })).toThrow(/finite numbers/);
    });

    it('rejects corrupted snapshot buffers with invalid header or length', () => {
      expect(() => decodeSnapshot(new ArrayBuffer(5))).toThrow(RangeError);

      const truncated = new Uint8Array(SNAPSHOT_HEADER_BYTES + 5);
      const view = new DataView(truncated.buffer);
      view.setUint8(0, PROTOCOL_VERSION);
      view.setUint8(1, SNAPSHOT_MESSAGE_TYPE);
      view.setUint16(10, 1, true); // claims 1 entity (18 bytes), but only 5 provided
      expect(() => decodeSnapshot(truncated.buffer)).toThrow(RangeError);
    });

    it('rejects unknown entity kind in snapshot', () => {
      const buffer = new Uint8Array(SNAPSHOT_HEADER_BYTES + SNAPSHOT_ENTITY_BYTES);
      const view = new DataView(buffer.buffer);
      view.setUint8(0, PROTOCOL_VERSION);
      view.setUint8(1, SNAPSHOT_MESSAGE_TYPE);
      view.setUint16(10, 1, true);
      view.setUint8(SNAPSHOT_HEADER_BYTES + 2, 99); // invalid kind
      expect(() => decodeSnapshot(buffer.buffer)).toThrow(/unsupported snapshot entity kind/);
    });
  });
});
