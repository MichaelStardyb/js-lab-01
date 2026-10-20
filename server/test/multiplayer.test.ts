import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { decodeSnapshot, encodeInput, type SnapshotEntity, type SnapshotMessage } from 'shared/protocol/binaryCodec.js';
import { createGameServer } from '../src/app.js';
import { loadConfig } from '../src/config.js';

function isRecord(data: unknown): data is Record<string, unknown> {
  return typeof data === 'object' && data !== null;
}

function waitForMessage<T = Record<string, unknown>>(
  socket: WebSocket,
  predicate: (message: Record<string, unknown>) => boolean,
  timeoutMs = 4000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error('Timed out waiting for WebSocket message'));
    }, timeoutMs);
    const onMessage = (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      let value: unknown;
      try {
        value = isBinary ? decodeSnapshot(data) : JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!isRecord(value) || !predicate(value)) return;
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(value as T);
    };
    socket.on('message', onMessage);
  });
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
}

describe('server multiplayer room and netcode', () => {
  it('room clients exchange authoritative snapshots using JSON and binary while retaining chat', async () => {
    const logDir = await mkdtemp(join(tmpdir(), 'dogfight-netcode-'));
    const config = {
      ...loadConfig({ LOG_DIR: logDir }),
      port: 0,
      rateLimitPerSec: 15,
      inputRateLimitPerSec: 90,
    };
    const runtime = createGameServer({ config, staticDir: null });
    const clients: WebSocket[] = [];
    try {
      const address = await runtime.listen(0, '127.0.0.1');
      if (!address || typeof address === 'string') throw new Error('Address not found');
      const url = `ws://127.0.0.1:${address.port}/ws?delay=0&jitter=0&drop=0`;
      const jsonClient = new WebSocket(`${url}&codec=json`);
      const binaryClient = new WebSocket(`${url}&codec=binary`);
      clients.push(jsonClient, binaryClient);
      await Promise.all([waitForOpen(jsonClient), waitForOpen(binaryClient)]);

      const jsonJoined = waitForMessage<{ entityId: number }>(jsonClient, (message) => message.type === 'joined');
      jsonClient.send(JSON.stringify({ v: 0, type: 'join', room: 'lab5', name: 'JSON Pilot' }));
      const ownJson = await jsonJoined;
      const binaryJoined = waitForMessage<{ entityId: number }>(binaryClient, (message) => message.type === 'joined');
      binaryClient.send(JSON.stringify({ v: 0, type: 'join', room: 'lab5', name: 'Binary Pilot' }));
      const ownBinary = await binaryJoined;

      const jsonSnapshot = waitForMessage<SnapshotMessage>(
        jsonClient,
        (message) => message.type === 'snapshot' && typeof message.lastProcessedSeq === 'number' && message.lastProcessedSeq >= 40
      );
      const binarySnapshot = waitForMessage<SnapshotMessage>(
        binaryClient,
        (message) => message.type === 'snapshot' && typeof message.lastProcessedSeq === 'number' && message.lastProcessedSeq >= 40
      );
      for (let seq = 1; seq <= 40; seq += 1) {
        jsonClient.send(JSON.stringify({
          v: 1, type: 'input', seq, thrust: true, turnLeft: false, turnRight: false, fire: false,
        }));
        binaryClient.send(Buffer.from(encodeInput({
          v: 1, type: 'input', seq, thrust: true, turnLeft: false, turnRight: false, fire: true,
        })));
      }
      const [jsonState, binaryState] = await Promise.all([
        jsonSnapshot,
        binarySnapshot,
      ]);
      const ownJsonId = ownJson.entityId;
      const ownBinaryId = ownBinary.entityId;
      expect(jsonState.entities.some((entity: SnapshotEntity) => entity.id === ownJsonId)).toBe(true);
      expect(binaryState.entities.some((entity: SnapshotEntity) => entity.id === ownBinaryId)).toBe(true);
      expect(jsonState.entities.filter((entity: SnapshotEntity) => entity.kind === 1).length).toBeGreaterThanOrEqual(2);
      expect(binaryState.entities.filter((entity: SnapshotEntity) => entity.kind === 1).length).toBeGreaterThanOrEqual(2);
      const jsonShip = jsonState.entities.find((entity: SnapshotEntity) => entity.id === ownJsonId)!;
      const binaryShip = binaryState.entities.find((entity: SnapshotEntity) => entity.id === ownBinaryId)!;
      expect(Math.hypot(jsonShip.vx, jsonShip.vy)).toBeGreaterThan(0);
      expect(Math.hypot(binaryShip.vx, binaryShip.vy)).toBeGreaterThan(0);

      const chat = waitForMessage<{ name: string }>(binaryClient, (message) => message.type === 'chat' && message.text === 'gg');
      jsonClient.send(JSON.stringify({ v: 0, type: 'chat', text: 'gg' }));
      expect((await chat).name).toBe('JSON Pilot');

      const statsResponse = await fetch(`http://127.0.0.1:${address.port}/api/stats`);
      expect(statsResponse.status).toBe(200);
      const statsData = await statsResponse.json() as Record<string, unknown>;
      expect(statsData['tickRate']).toBe(30);
      expect(statsData['activeSessions']).toBe(1);
      expect(statsData['players']).toBe(2);
      expect(Number(statsData['ticks'])).toBeGreaterThan(0);
    } finally {
      for (const client of clients) client.close();
      await runtime.close();
      await rm(logDir, { recursive: true, force: true });
    }
  });
});
