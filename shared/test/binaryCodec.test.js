import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeInput, decodeSnapshot, encodeInput, encodeSnapshot } from '../protocol/binaryCodec.js';

test('input packets round-trip with a 7-byte little-endian format', () => {
  const input = { seq: 0x12345678, thrust: true, turnLeft: false, turnRight: true, fire: true };
  const encoded = encodeInput(input);
  assert.equal(encoded.byteLength, 7);
  assert.deepEqual([...new Uint8Array(encoded).slice(2, 6)], [0x78, 0x56, 0x34, 0x12]);
  assert.deepEqual(decodeInput(encoded), { type: 'input', ...input });
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
  assert.equal(decoded.entities[0].x, snapshot.entities[0].x);
  assert.equal(decoded.entities[0].y, snapshot.entities[0].y);
  const angleError = Math.atan2(
    Math.sin(decoded.entities[0].angle - snapshot.entities[0].angle),
    Math.cos(decoded.entities[0].angle - snapshot.entities[0].angle),
  );
  assert.ok(Math.abs(angleError) <= 0.000051);
  assert.equal(decoded.entities[0].vx, -100);
  assert.equal(decoded.entities[0].vy, 140);
  assert.throws(() => encodeSnapshot({
    tick: 0, lastProcessedSeq: 0,
    entities: [{ ...snapshot.entities[0], x: Number.NaN }],
  }), /finite numbers/);
});
