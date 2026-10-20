import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeInput, decodeSnapshot, encodeInput, encodeSnapshot } from '../protocol/binaryCodec.js';

test('input packets round-trip with a 7-byte little-endian format', () => {
  const input: Parameters<typeof encodeInput>[0] = { v: 1, type: 'input', seq: 0x12345678, thrust: true, turnLeft: false, turnRight: true, fire: true };
  const encoded = encodeInput(input);
  assert.equal(encoded.byteLength, 7);
  assert.deepEqual([...new Uint8Array(encoded).slice(2, 6)], [0x78, 0x56, 0x34, 0x12]);
  const decoded = decodeInput(encoded);
  assert.deepEqual(decoded, { type: 'input', seq: input.seq, thrust: input.thrust, turnLeft: input.turnLeft, turnRight: input.turnRight, fire: input.fire });
});

test('snapshots round-trip with documented quantization', () => {
  const snapshot = {
    tick: 1234,
    lastProcessedSeq: 998,
    entities: [{ id: 8, kind: 1, x: 12.5, y: 99.25, angle: 5.8, vx: -100, vy: 140 }],
  };
  const decoded = decodeSnapshot(encodeSnapshot(snapshot));
  assert.equal(decoded.tick, snapshot.tick);
  assert.equal(decoded.lastProcessedSeq, snapshot.lastProcessedSeq);
  assert.equal(decoded.entities[0]?.x, snapshot.entities[0]?.x);
  assert.equal(decoded.entities[0]?.y, snapshot.entities[0]?.y);
  const angleError = Math.atan2(
    Math.sin((decoded.entities[0]?.angle ?? 0) - (snapshot.entities[0]?.angle ?? 0)),
    Math.cos((decoded.entities[0]?.angle ?? 0) - (snapshot.entities[0]?.angle ?? 0)),
  );
  assert.ok(Math.abs(angleError) <= 0.000051);
  assert.equal(decoded.entities[0]?.vx, -100);
  assert.equal(decoded.entities[0]?.vy, 140);
  assert.throws(() => encodeSnapshot({
    tick: 0, lastProcessedSeq: 0,
    entities: [{ ...snapshot.entities[0]!, x: Number.NaN }],
  }), /finite numbers/);

  const multiplayerSnapshot = {
    tick: 50,
    lastProcessedSeq: 20,
    entities: [
      { id: 1, kind: 1, x: 100, y: 150, angle: 1.2, vx: 10, vy: 20 },
      { id: 2, kind: 2, x: 200, y: 250, angle: 0.5, vx: 300, vy: 0 },
      { id: 3, kind: 3, x: 300, y: 350, angle: 2.1, vx: -15, vy: 15 },
      { id: 4, kind: 4, x: 400, y: 450, angle: 0, vx: 0, vy: 0 },
    ],
  };
  const decodedMulti = decodeSnapshot(encodeSnapshot(multiplayerSnapshot));
  assert.equal(decodedMulti.entities.length, 4);
  assert.equal(decodedMulti.entities[2]?.kind, 3);
  assert.equal(decodedMulti.entities[3]?.kind, 4);
});
