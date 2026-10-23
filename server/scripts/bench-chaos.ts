import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { WebSocket } from 'ws';
import { encodeInput } from 'shared/protocol/binaryCodec.js';
import { createGameServer } from '../src/app.js';
import { loadConfig } from '../src/config.js';

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
}

function waitForClose(socket: WebSocket, timeoutMs = 4000): Promise<number> {
  return new Promise((resolve, reject) => {
    if (socket.readyState === WebSocket.CLOSED) {
      resolve(1000);
      return;
    }
    const timer = setTimeout(() => reject(new Error('Timeout waiting for close')), timeoutMs);
    socket.once('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

async function runChaosAndLoadBenchmark() {
  const logDir = await mkdtemp(join(tmpdir(), 'dogfight-bench-chaos-'));
  const config = loadConfig({
    LOG_DIR: logDir,
    PORT: '0',
    LOG_LEVEL: 'silent',
    MAX_ROOMS: '100',
    MAX_CONNECTIONS_PER_IP: '500',
  });
  const runtime = createGameServer({ config, staticDir: null });
  const sockets: WebSocket[] = [];

  try {
    const addr = await runtime.listen(0, '127.0.0.1');
    if (!addr || typeof addr === 'string') throw new Error('Failed to bind');
    const wsUrl = `ws://127.0.0.1:${addr.port}/ws?delay=0&jitter=0&drop=0&codec=binary`;

    // 1. Spin up 8 active rooms with 4 players each (32 concurrent players @ 30 Hz)
    const roomsCount = 8;
    const playersPerRoom = 4;
    for (let r = 1; r <= roomsCount; r++) {
      for (let p = 1; p <= playersPerRoom; p++) {
        const ws = new WebSocket(wsUrl);
        sockets.push(ws);
        await waitForOpen(ws);
        ws.send(JSON.stringify({ v: 0, type: 'join', room: `arena-${r}`, name: `Bot_${r}_${p}` }));
      }
    }

    // Drive 30 Hz binary inputs for 500ms to establish baseline tick metrics
    let seq = 1;
    const inputTimer = setInterval(() => {
      seq += 1;
      const frame = Buffer.from(
        encodeInput({
          v: 1,
          type: 'input',
          seq,
          thrust: true,
          turnLeft: seq % 2 === 0,
          turnRight: seq % 2 !== 0,
          fire: seq % 5 === 0,
        }),
      );
      for (const ws of sockets) {
        if (ws.readyState === WebSocket.OPEN) ws.send(frame);
      }
    }, 33);

    await new Promise((r) => setTimeout(r, 600));
    const beforeFlood = runtime.metrics.getSnapshot();
    const room1Before = beforeFlood.roomStats['arena-1'] ?? { tickAvgMs: 0, tickP99Ms: 0, tickMaxMs: 0 };

    // 2. Chaos Phase: Inject 1,000 corrupted frames/sec across 20 rogue connections
    const rogueCount = 20;
    const framesPerRogue = 50; // 20 * 50 = 1,000 garbage frames
    const rogues: WebSocket[] = [];
    for (let i = 0; i < rogueCount; i++) {
      const rogue = new WebSocket(`ws://127.0.0.1:${addr.port}/ws?delay=0&jitter=0&drop=0`);
      rogues.push(rogue);
    }
    await Promise.all(rogues.map((r) => waitForOpen(r)));

    const floodStart = performance.now();
    const closePromises = rogues.map((r) => waitForClose(r));
    for (const rogue of rogues) {
      for (let f = 0; f < framesPerRogue; f++) {
        if (rogue.readyState === WebSocket.OPEN) {
          rogue.send('{corrupted_frame_payload:not_valid_json');
        }
      }
    }
    await Promise.all(closePromises);
    const floodElapsedMs = performance.now() - floodStart;

    await new Promise((r) => setTimeout(r, 400));
    clearInterval(inputTimer);

    const afterFlood = runtime.metrics.getSnapshot();
    const room1After = afterFlood.roomStats['arena-1'] ?? { tickAvgMs: 0, tickP99Ms: 0, tickMaxMs: 0 };

    // 3. Measure graceful SIGTERM shutdown time with 32 active players
    const shutdownStart = performance.now();
    await runtime.close();
    const shutdownMs = performance.now() - shutdownStart;

    console.log(
      JSON.stringify(
        {
          benchmark: 'Lab 8 Load, Chaos & Isolation Verification',
          activeRooms: roomsCount,
          concurrentPlayers: roomsCount * playersPerRoom,
          baselineArena1TickMs: room1Before,
          during1000GarbageFramesPerSecArena1TickMs: room1After,
          garbageFlood: {
            rogueConnections: rogueCount,
            corruptedFramesSent: rogueCount * framesPerRogue,
            allDisconnectedInMs: Number(floodElapsedMs.toFixed(2)),
            rejectedInvalidPayloads: afterFlood.rejections.invalid_payload ?? 0,
          },
          eventLoopUtilization: afterFlood.eventLoopUtilization,
          rssMiB: Number((afterFlood.memory.rss / 1024 / 1024).toFixed(2)),
          gracefulShutdownMs: Number(shutdownMs.toFixed(2)),
        },
        null,
        2,
      ),
    );
  } finally {
    for (const ws of sockets) ws.close();
    await runtime.close();
    await rm(logDir, { recursive: true, force: true });
  }
}

runChaosAndLoadBenchmark().catch((err) => {
  console.error('Chaos benchmark failed:', err);
  process.exitCode = 1;
});
