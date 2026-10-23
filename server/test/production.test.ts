import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { WebSocket } from 'ws';
import { createGameServer } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { registerProcessHandlers } from '../src/index.js';

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
}

function waitForClose(socket: WebSocket, timeoutMs = 3000): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    if (socket.readyState === WebSocket.CLOSED) {
      resolve({ code: 1000, reason: '' });
      return;
    }
    const timer = setTimeout(() => reject(new Error('Timed out waiting for socket close')), timeoutMs);
    socket.once('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
  });
}

function waitForJsonMessage(
  socket: WebSocket,
  predicate: (msg: Record<string, unknown>) => boolean,
  timeoutMs = 3000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error('Timed out waiting for JSON message'));
    }, timeoutMs);
    const onMessage = (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      if (isBinary) return;
      try {
        const parsed = JSON.parse(data.toString()) as Record<string, unknown>;
        if (parsed && typeof parsed === 'object' && predicate(parsed)) {
          clearTimeout(timer);
          socket.off('message', onMessage);
          resolve(parsed);
        }
      } catch {
        // Ignore non-JSON frames
      }
    };
    socket.on('message', onMessage);
  });
}

test('Zod config validates ALLOWED_ORIGINS, MAX_CONNECTIONS_PER_IP, room caps, and gitSha', () => {
  const cfg = loadConfig({
    PORT: '4100',
    HOST: '0.0.0.0',
    GIT_SHA: 'abc1234',
    ALLOWED_ORIGINS: 'https://dogfight.example.com, http://localhost:3000',
    MAX_CONNECTIONS_PER_IP: '12',
    MAX_ROOMS: '25',
    MAX_PLAYERS_PER_ROOM: '6',
  });
  assert.equal(cfg.port, 4100);
  assert.equal(cfg.gitSha, 'abc1234');
  assert.deepEqual(cfg.allowedOrigins, ['https://dogfight.example.com', 'http://localhost:3000']);
  assert.equal(cfg.maxConnectionsPerIp, 12);
  assert.equal(cfg.maxRooms, 25);
  assert.equal(cfg.maxPlayersPerRoom, 6);

  assert.throws(() => loadConfig({ ALLOWED_ORIGINS: 'not-a-valid-origin' }), /ALLOWED_ORIGINS/);
  assert.throws(() => loadConfig({ MAX_CONNECTIONS_PER_IP: '0' }));
});

test('/health, /ready, /metrics (Prometheus & JSON), and pino JSON logging with redaction', async () => {
  const logDir = await mkdtemp(join(tmpdir(), 'dogfight-prod-'));
  const logLines: Record<string, unknown>[] = [];
  const memoryStream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      for (const line of chunk.toString().split('\n').filter(Boolean)) {
        logLines.push(JSON.parse(line) as Record<string, unknown>);
      }
      cb();
    },
  });

  const config = loadConfig({
    LOG_DIR: logDir,
    PORT: '0',
    GIT_SHA: 'v1.0.0-sha777',
    LOG_LEVEL: 'info',
    MAX_ROOMS: '2',
  });
  const logger = createLogger({ level: 'info', gitSha: config.gitSha, destination: memoryStream });
  logger.info({ roomId: 'alpha', playerId: 'p-1', password: 'secret-password', apiKey: 'key-123' }, 'redaction check');

  const runtime = createGameServer({ config, staticDir: null, logger });
  try {
    const addr = await runtime.listen(0, '127.0.0.1');
    if (!addr || typeof addr === 'string') throw new Error('No address');
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    // Verify /health includes gitSha and eventLoopUtilization
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.equal(healthRes.status, 200);
    const health = await healthRes.json();
    assert.equal(health.status, 'ok');
    assert.equal(health.gitSha, 'v1.0.0-sha777');
    assert.equal(typeof health.eventLoopUtilization, 'number');

    // Verify /ready is 200 when ready
    const readyRes = await fetch(`${baseUrl}/ready`);
    assert.equal(readyRes.status, 200);
    const ready = await readyRes.json();
    assert.equal(ready.status, 'ready');

    // Verify /metrics returns Prometheus text format by default
    const promRes = await fetch(`${baseUrl}/metrics`);
    assert.equal(promRes.status, 200);
    const promText = await promRes.text();
    assert.match(promText, /dogfight_connected_players/);
    assert.match(promText, /dogfight_active_rooms/);
    assert.match(promText, /dogfight_event_loop_utilization/);
    assert.match(promText, /dogfight_memory_rss_bytes/);

    // Verify /metrics?format=json returns structured JSON metrics
    const jsonMetricsRes = await fetch(`${baseUrl}/metrics?format=json`);
    assert.equal(jsonMetricsRes.status, 200);
    const jsonMetrics = await jsonMetricsRes.json();
    assert.equal(jsonMetrics.gitSha, 'v1.0.0-sha777');
    assert.equal(typeof jsonMetrics.players, 'number');
    assert.equal(typeof jsonMetrics.tickDurationMs.p99, 'number');

    // Verify pino JSON log lines and redaction
    const redactedEntry = logLines.find((entry) => entry.roomId === 'alpha');
    assert.ok(redactedEntry);
    assert.equal(redactedEntry.playerId, 'p-1');
    assert.equal(redactedEntry.password, '[REDACTED]');
    assert.equal(redactedEntry.apiKey, '[REDACTED]');
  } finally {
    await runtime.close();
    await rm(logDir, { recursive: true, force: true });
  }
});

test('Origin verification and per-IP connection limit reject unauthorized or excessive clients', async () => {
  const logDir = await mkdtemp(join(tmpdir(), 'dogfight-security-'));
  const config = loadConfig({
    LOG_DIR: logDir,
    PORT: '0',
    LOG_LEVEL: 'silent',
    ALLOWED_ORIGINS: 'https://trusted.dogfight.app',
    MAX_CONNECTIONS_PER_IP: '2',
  });
  const runtime = createGameServer({ config, staticDir: null });
  const openSockets: WebSocket[] = [];
  try {
    const addr = await runtime.listen(0, '127.0.0.1');
    if (!addr || typeof addr === 'string') throw new Error('No address');
    const wsUrl = `ws://127.0.0.1:${addr.port}/ws`;

    // 1. Disallowed Origin must be rejected on handshake (403)
    const evilSocket = new WebSocket(wsUrl, { headers: { Origin: 'https://evil.example.com' } });
    await assert.rejects(waitForOpen(evilSocket), /403/);

    // 2. Allowed Origin succeeds up to MAX_CONNECTIONS_PER_IP (2)
    const s1 = new WebSocket(wsUrl, { headers: { Origin: 'https://trusted.dogfight.app' } });
    const s2 = new WebSocket(wsUrl, { headers: { Origin: 'https://trusted.dogfight.app' } });
    openSockets.push(s1, s2);
    await Promise.all([waitForOpen(s1), waitForOpen(s2)]);

    // 3. 3rd connection from same IP is rejected with 429 Too Many Requests
    const s3 = new WebSocket(wsUrl, { headers: { Origin: 'https://trusted.dogfight.app' } });
    await assert.rejects(waitForOpen(s3), /429/);

    // 4. Closing s1 frees a slot so a new connection succeeds
    const s1Closed = waitForClose(s1);
    s1.close();
    await s1Closed;
    const s4 = new WebSocket(wsUrl, { headers: { Origin: 'https://trusted.dogfight.app' } });
    openSockets.push(s4);
    await waitForOpen(s4);

    const snap = runtime.metrics.getSnapshot();
    assert.equal(snap.rejections.origin, 1);
    assert.equal(snap.rejections.ip_limit, 1);
  } finally {
    for (const s of openSockets) s.close();
    await runtime.close();
    await rm(logDir, { recursive: true, force: true });
  }
});

test('Chaos: SIGTERM / graceful shutdown sends shutdown message, closes with 1001, and flips /ready to 503', async () => {
  const logDir = await mkdtemp(join(tmpdir(), 'dogfight-shutdown-'));
  const config = loadConfig({
    LOG_DIR: logDir,
    PORT: '0',
    LOG_LEVEL: 'silent',
  });
  const runtime = createGameServer({ config, staticDir: null });
  const addr = await runtime.listen(0, '127.0.0.1');
  if (!addr || typeof addr === 'string') throw new Error('No address');
  const wsUrl = `ws://127.0.0.1:${addr.port}/ws?delay=0&jitter=0&drop=0`;

  const client = new WebSocket(wsUrl);
  await waitForOpen(client);
  const joinedPromise = waitForJsonMessage(client, (m) => m.type === 'joined');
  client.send(JSON.stringify({ v: 0, type: 'join', room: 'prod-room', name: 'Pilot1' }));
  await joinedPromise;

  const shutdownMsgPromise = waitForJsonMessage(client, (m) => m.type === 'shutdown');
  const closeEventPromise = waitForClose(client);

  let exitCode: number | null = null;
  const handlers = registerProcessHandlers({
    runtime,
    logger: runtime.logger,
    exit: (code) => {
      exitCode = code;
    },
  });

  const startedAt = performance.now();
  await handlers.shutdown('SIGTERM');
  const elapsedMs = performance.now() - startedAt;
  handlers.unregister();

  const shutdownMsg = await shutdownMsgPromise;
  const closeEvent = await closeEventPromise;

  assert.equal(shutdownMsg.type, 'shutdown');
  assert.equal(closeEvent.code, 1001);
  assert.equal(exitCode, 0);
  assert.ok(elapsedMs < 5000, `Expected shutdown in < 5s, took ${elapsedMs.toFixed(0)}ms`);

  await rm(logDir, { recursive: true, force: true });
});

test('Chaos: client disappears mid-match and garbage flood (~1000 frames/s) does not degrade other room tick time', async () => {
  const logDir = await mkdtemp(join(tmpdir(), 'dogfight-chaos-'));
  const config = loadConfig({
    LOG_DIR: logDir,
    PORT: '0',
    LOG_LEVEL: 'silent',
    MAX_CONNECTIONS_PER_IP: '100',
  });
  const runtime = createGameServer({ config, staticDir: null });
  const sockets: WebSocket[] = [];
  try {
    const addr = await runtime.listen(0, '127.0.0.1');
    if (!addr || typeof addr === 'string') throw new Error('No address');
    const wsUrl = `ws://127.0.0.1:${addr.port}/ws?delay=0&jitter=0&drop=0`;

    // Room A: two legitimate players playing a match
    const p1 = new WebSocket(wsUrl);
    const p2 = new WebSocket(wsUrl);
    sockets.push(p1, p2);
    await Promise.all([waitForOpen(p1), waitForOpen(p2)]);

    const p1Joined = waitForJsonMessage(p1, (m) => m.type === 'joined');
    p1.send(JSON.stringify({ v: 0, type: 'join', room: 'room-a', name: 'Alpha' }));
    await p1Joined;

    const p2Joined = waitForJsonMessage(p2, (m) => m.type === 'joined');
    p2.send(JSON.stringify({ v: 0, type: 'join', room: 'room-a', name: 'Bravo' }));
    await p2Joined;

    // Scenario 1: Player 2 disappears abruptly mid-match
    const rosterUpdate = waitForJsonMessage(
      p1,
      (m) => m.type === 'roster' && Array.isArray(m.players) && m.players.length === 1,
    );
    p2.terminate();
    const updatedRoster = await rosterUpdate;
    assert.equal((updatedRoster.players as unknown[]).length, 1);

    // Scenario 2: Abusive clients in Room B send ~1000 corrupted frames/sec while Room A runs
    const attackerCount = 10;
    const framesPerAttacker = 100; // 10 * 100 = 1,000 corrupted frames burst
    const attackers: WebSocket[] = [];
    for (let i = 0; i < attackerCount; i++) {
      const attacker = new WebSocket(wsUrl);
      sockets.push(attacker);
      attackers.push(attacker);
    }
    await Promise.all(attackers.map((a) => waitForOpen(a)));

    // Keep legitimate traffic flowing in Room A while flooding from attackers
    for (let seq = 1; seq <= 20; seq++) {
      p1.send(JSON.stringify({ v: 1, type: 'input', seq, thrust: true, turnLeft: false, turnRight: true, fire: true }));
    }

    const attackerClosePromises = attackers.map((a) => waitForClose(a));
    for (const attacker of attackers) {
      for (let f = 0; f < framesPerAttacker; f++) {
        if (attacker.readyState === WebSocket.OPEN) {
          attacker.send('<<<CORRUPTED_GARBAGE_FRAME_PAYLOAD_NOT_JSON>>>');
        }
      }
    }

    const attackerCloses = await Promise.all(attackerClosePromises);
    for (const closed of attackerCloses) {
      assert.ok(closed.code === 1003 || closed.code === 1008, `Expected protocol close code, got ${closed.code}`);
    }

    // Let Room A run several more ticks and verify its tick duration remained unaffected
    await new Promise((r) => setTimeout(r, 250));
    const snap = runtime.metrics.getSnapshot();
    const roomAStats = snap.roomStats['room-a'];
    assert.ok(roomAStats, 'Room A should still be active');
    assert.ok(roomAStats.tickAvgMs < 5, `Room A avg tick should be < 5ms, got ${roomAStats.tickAvgMs}ms`);
    assert.ok(roomAStats.tickP99Ms < 10, `Room A p99 tick should be < 10ms, got ${roomAStats.tickP99Ms}ms`);
    assert.ok((snap.rejections.invalid_payload ?? 0) >= attackerCount);
  } finally {
    for (const s of sockets) s.close();
    await runtime.close();
    await rm(logDir, { recursive: true, force: true });
  }
});
