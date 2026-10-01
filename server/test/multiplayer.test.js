import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { decodeSnapshot, encodeInput } from 'shared/protocol/binaryCodec';
import { createGameServer } from '../src/app.js';
import { loadConfig } from '../src/config.js';

function waitForMessage(socket, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error('Timed out waiting for WebSocket message'));
    }, timeoutMs);
    const onMessage = (data, isBinary) => {
      let value;
      try {
        value = isBinary ? decodeSnapshot(data) : JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!predicate(value)) return;
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(value);
    };
    socket.on('message', onMessage);
  });
}

function waitForOpen(socket) {
  return new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
}

test('room clients exchange authoritative snapshots using JSON and binary while retaining chat', async () => {
  const logDir = await mkdtemp(join(tmpdir(), 'dogfight-netcode-'));
  const config = {
    ...loadConfig({ LOG_DIR: logDir }),
    port: 0,
    rateLimitPerSec: 15,
    inputRateLimitPerSec: 90,
  };
  const runtime = createGameServer({ config, staticDir: null });
  const clients = [];
  try {
    const address = await runtime.listen(0, '127.0.0.1');
    const url = `ws://127.0.0.1:${address.port}/ws?delay=0&jitter=0&drop=0`;
    const jsonClient = new WebSocket(`${url}&codec=json`);
    const binaryClient = new WebSocket(`${url}&codec=binary`);
    clients.push(jsonClient, binaryClient);
    await Promise.all([waitForOpen(jsonClient), waitForOpen(binaryClient)]);

    const jsonJoined = waitForMessage(jsonClient, (message) => message.type === 'joined');
    jsonClient.send(JSON.stringify({ v: 0, type: 'join', room: 'lab5', name: 'JSON Pilot' }));
    const ownJson = await jsonJoined;
    const binaryJoined = waitForMessage(binaryClient, (message) => message.type === 'joined');
    binaryClient.send(JSON.stringify({ v: 0, type: 'join', room: 'lab5', name: 'Binary Pilot' }));
    const ownBinary = await binaryJoined;

    const jsonSnapshot = waitForMessage(jsonClient, (message) => message.type === 'snapshot' && message.lastProcessedSeq >= 40);
    const binarySnapshot = waitForMessage(binaryClient, (message) => message.type === 'snapshot' && message.lastProcessedSeq >= 40);
    for (let seq = 1; seq <= 40; seq += 1) {
      jsonClient.send(JSON.stringify({
        v: 1, type: 'input', seq, thrust: true, turnLeft: false, turnRight: false, fire: false,
      }));
      binaryClient.send(Buffer.from(encodeInput({
        seq, thrust: true, turnLeft: false, turnRight: false, fire: true,
      })));
    }
    const [jsonState, binaryState] = await Promise.all([jsonSnapshot, binarySnapshot]);
    assert.ok(jsonState.entities.some((entity) => entity.id === ownJson.entityId));
    assert.ok(binaryState.entities.some((entity) => entity.id === ownBinary.entityId));
    assert.ok(jsonState.entities.filter((entity) => entity.kind === 1).length >= 2);
    assert.ok(binaryState.entities.filter((entity) => entity.kind === 1).length >= 2);
    const jsonShip = jsonState.entities.find((entity) => entity.id === ownJson.entityId);
    const binaryShip = binaryState.entities.find((entity) => entity.id === ownBinary.entityId);
    assert.ok(Math.hypot(jsonShip.vx, jsonShip.vy) > 0);
    assert.ok(Math.hypot(binaryShip.vx, binaryShip.vy) > 0);

    const chat = waitForMessage(binaryClient, (message) => message.type === 'chat' && message.text === 'gg');
    jsonClient.send(JSON.stringify({ v: 0, type: 'chat', text: 'gg' }));
    assert.equal((await chat).name, 'JSON Pilot');

    const statsResponse = await fetch(`http://127.0.0.1:${address.port}/api/stats`);
    assert.equal(statsResponse.status, 200);
    const statsData = await statsResponse.json();
    assert.equal(statsData.tickRate, 30);
    assert.equal(statsData.activeSessions, 1);
    assert.equal(statsData.players, 2);
    assert.ok(statsData.ticks > 0);
  } finally {
    for (const client of clients) client.close();
    await runtime.close();
    await rm(logDir, { recursive: true, force: true });
  }
});
