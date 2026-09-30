import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeInput } from 'shared/protocol/binaryCodec';
import { parseNetworkSettings } from '../src/latency.js';
import { validateClientMessage } from '../src/protocol.js';

test('server accepts validated JSON and binary inputs', () => {
  const json = Buffer.from(JSON.stringify({
    v: 1, type: 'input', seq: 14, thrust: true, turnLeft: false, turnRight: true, fire: false,
  }));
  assert.equal(validateClientMessage(json, 1000).value.seq, 14);
  assert.equal(validateClientMessage(Buffer.from(encodeInput({
    seq: 15, thrust: false, turnLeft: true, turnRight: false, fire: true,
  })), 1000, true).value.seq, 15);
  assert.ok(validateClientMessage(Buffer.from('{"v":1,"type":"input","seq":-1}'), 1000).error);
});

test('network query values are validated and default to the documented injector', () => {
  const settings = parseNetworkSettings(new URLSearchParams());
  assert.equal(settings.codec, 'json');
  assert.equal(settings.injector.minLatency, 100);
  assert.equal(settings.injector.jitter, 15);
  assert.equal(settings.injector.dropRate, 0.02);
  assert.throws(() => parseNetworkSettings(new URLSearchParams('codec=other')), /codec/);
  assert.throws(() => parseNetworkSettings(new URLSearchParams('drop=2')), /dropRate/);
});
