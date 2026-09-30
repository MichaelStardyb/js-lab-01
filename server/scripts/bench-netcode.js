import { performance } from 'node:perf_hooks';
import { decodeSnapshot, encodeInput, encodeSnapshot } from 'shared/protocol/binaryCodec';

const entities = Array.from({ length: 8 }, (_, index) => ({
  id: index + 1,
  kind: index < 4 ? 1 : 2,
  x: 100 + index * 31.25,
  y: 200 + index * 23.5,
  angle: index * 0.41,
  vx: index * 8,
  vy: -index * 4,
}));
const snapshot = { v: 1, type: 'snapshot', tick: 1200, lastProcessedSeq: 400, entities };
const jsonSnapshot = Buffer.from(JSON.stringify(snapshot));
const binarySnapshot = encodeSnapshot(snapshot);
const jsonInput = Buffer.from(JSON.stringify({
  v: 1, type: 'input', seq: 400, thrust: true, turnLeft: false, turnRight: true, fire: false,
}));
const binaryInput = encodeInput({ seq: 400, thrust: true, turnLeft: false, turnRight: true, fire: false });
const rounds = 20000;

function measure(callback) {
  const start = performance.now();
  for (let index = 0; index < rounds; index += 1) callback();
  return ((performance.now() - start) * 1000) / rounds;
}

const jsonEncodeDecodeUs = measure(() => {
  const encoded = JSON.stringify(snapshot);
  JSON.parse(encoded);
});
const binaryEncodeDecodeUs = measure(() => decodeSnapshot(encodeSnapshot(snapshot)));
const snapshotsPerSecond = 30;
const jsonDown = jsonSnapshot.byteLength * snapshotsPerSecond / 1024;
const binaryDown = binarySnapshot.byteLength * snapshotsPerSecond / 1024;
const jsonUp = jsonInput.byteLength * snapshotsPerSecond / 1024;
const binaryUp = binaryInput.byteLength * snapshotsPerSecond / 1024;

console.log(JSON.stringify({
  scenario: '4 players at 30 Hz, 4 ships + 4 bullets per snapshot, per client',
  rounds,
  json: {
    snapshotBytes: jsonSnapshot.byteLength,
    downKBps: Number(jsonDown.toFixed(3)),
    inputBytes: jsonInput.byteLength,
    upKBps: Number(jsonUp.toFixed(3)),
    encodeDecodeMicroseconds: Number(jsonEncodeDecodeUs.toFixed(3)),
  },
  binary: {
    snapshotBytes: binarySnapshot.byteLength,
    downKBps: Number(binaryDown.toFixed(3)),
    inputBytes: binaryInput.byteLength,
    upKBps: Number(binaryUp.toFixed(3)),
    encodeDecodeMicroseconds: Number(binaryEncodeDecodeUs.toFixed(3)),
  },
}, null, 2));
