import { WebSocket } from 'ws';
import { decodeSnapshot, encodeInput, SHIP_KIND, type SnapshotEntity } from 'shared/protocol/binaryCodec.js';
import { decideBotInput } from 'shared/sim/bot.js';
import { mulberry32 } from 'shared/sim/prng.js';
import { asSeq } from 'shared/protocol/schema.js';

export interface BotRunnerOptions {
  count?: number;
  room?: string;
  duration?: number;
  url?: string;
  codec?: 'binary' | 'json';
  onLog?: (msg: string) => void;
}

export interface BotRunner {
  stop: () => Promise<void>;
}

export async function startBots({
  count = 8,
  room = 'demo',
  duration = 60,
  url = 'ws://127.0.0.1:3000/ws',
  codec = 'binary',
  onLog = console.log,
}: BotRunnerOptions = {}): Promise<BotRunner> {
  const sockets: WebSocket[] = [];
  const intervals: Array<ReturnType<typeof setInterval>> = [];
  let isStopped = false;

  for (let i = 1; i <= count; i++) {
    const botName = `bot-${i}`;
    const rng = mulberry32(1000 + i * 37);
    const hasQuery = url.includes('?');
    const wsUrl = hasQuery ? `${url}&delay=0&jitter=0&drop=0` : `${url}?codec=${codec}&delay=0&jitter=0&drop=0`;
    const socket = new WebSocket(wsUrl);
    sockets.push(socket);

    let ownEntityId: number | null = null;
    let currentEntities: readonly SnapshotEntity[] = [];
    let seq = 0;

    socket.on('open', () => {
      socket.send(JSON.stringify({ v: 0, type: 'join', room, name: botName }));
    });

    socket.on('message', (data: Buffer | ArrayBuffer, isBinary: boolean) => {
      if (isStopped) return;
      try {
        if (isBinary || Buffer.isBuffer(data)) {
          const snapshot = decodeSnapshot(data);
          currentEntities = snapshot.entities;
        } else {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'joined') {
            ownEntityId = msg.entityId;
          } else if (msg.type === 'snapshot') {
            currentEntities = msg.entities ?? [];
          }
        }
      } catch {
        // Ignore unparseable frames
      }
    });

    socket.on('error', (err) => {
      if (!isStopped) onLog(`[${botName}] error: ${err.message}`);
    });

    // Send input at 30 TPS (~33.3ms), well within server rate limit (90/s)
    const timer = setInterval(() => {
      if (isStopped || socket.readyState !== WebSocket.OPEN) return;
      seq = (seq + 1) >>> 0;

      const selfShip = currentEntities.find((e) => e.id === ownEntityId && e.kind === SHIP_KIND);
      const selfState = selfShip
        ? { id: selfShip.id, x: selfShip.x, y: selfShip.y, angle: selfShip.angle, vx: selfShip.vx, vy: selfShip.vy }
        : { id: ownEntityId ?? i, x: 400, y: 300, angle: 0, vx: 0, vy: 0 };

      const input = decideBotInput({ self: selfState, entities: currentEntities }, rng);

      if (codec === 'binary') {
        const buf = encodeInput({
          v: 1,
          type: 'input',
          seq: asSeq(seq),
          thrust: input.thrust,
          turnLeft: input.turnLeft,
          turnRight: input.turnRight,
          fire: input.fire ?? false,
        });
        socket.send(buf);
      } else {
        socket.send(JSON.stringify({
          v: 1,
          type: 'input',
          seq,
          thrust: input.thrust,
          turnLeft: input.turnLeft,
          turnRight: input.turnRight,
          fire: input.fire ?? false,
        }));
      }
    }, 33);

    intervals.push(timer);
  }

  // Wait for all bot sockets to connect
  await Promise.all(
    sockets.map((s) => new Promise<void>((resolve) => {
      if (s.readyState === WebSocket.OPEN) resolve();
      else {
        s.once('open', () => resolve());
        s.once('error', () => resolve());
      }
    }))
  );

  onLog(`Started ${count} bots in room "${room}" against ${url} for ${duration}s`);

  async function stop(): Promise<void> {
    if (isStopped) return;
    isStopped = true;
    for (const timer of intervals) clearInterval(timer);
    for (const socket of sockets) {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    }
    onLog(`Stopped all ${count} bots`);
  }

  if (duration > 0 && duration < Infinity) {
    setTimeout(() => {
      stop().catch(() => {});
    }, duration * 1000);
  }

  return { stop };
}

// Direct CLI execution
if (process.argv[1]?.includes('run-bots')) {
  const args = process.argv.slice(2);
  function getArg(flag: string, defaultValue: string): string {
    const index = args.indexOf(flag);
    return index !== -1 && args[index + 1] ? args[index + 1]! : defaultValue;
  }

  const count = parseInt(getArg('--count', '8'), 10);
  const room = getArg('--room', 'demo');
  const duration = parseInt(getArg('--duration', '60'), 10);
  const url = getArg('--url', 'ws://127.0.0.1:3000/ws');
  const codec = (getArg('--codec', 'binary') === 'json' ? 'json' : 'binary') as 'binary' | 'json';

  startBots({ count, room, duration, url, codec }).then((runner) => {
    process.on('SIGINT', () => { runner.stop().then(() => process.exit(0)); });
    process.on('SIGTERM', () => { runner.stop().then(() => process.exit(0)); });
  });
}
