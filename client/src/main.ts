import { createLoop, type LoopStats } from './loop.js';
import { createInput } from './input.js';
import { lerpAngle } from 'shared/sim/arena';
import { integrate } from 'shared/sim/ship';
import { ObjectPool } from 'shared/sim/pool.js';
import { RoomConnection } from './connection.js';
import { createLobby } from './lobby.js';
import {
  SHIP_KIND,
  BULLET_KIND,
  ASTEROID_KIND,
  PICKUP_KIND,
  type SnapshotEntity,
  type SnapshotMessage,
} from 'shared/protocol/binaryCodec.js';
import { type EntityId, type Seq, asSeq } from 'shared/protocol/schema.js';
import './style.css';

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
    __e2e?: {
      getSnapshot: () => {
        ownEntityId: number | null;
        ownShip: { x: number; y: number; angle: number } | null;
        ships: Array<{ id: number; x: number; y: number; angle: number; hp: number }>;
      };
    };
    __perf?: {
      getMetrics: () => {
        frameCount: number;
        p50FrameMs: number;
        p95FrameMs: number;
        p99FrameMs: number;
        maxFrameMs: number;
        avgFrameMs: number;
        framesOver16ms: number;
        p50IntervalMs: number;
        p95IntervalMs: number;
        p99IntervalMs: number;
        longTaskCount: number;
        longAnimFrameCount: number;
        jsHeapUsedSize: number;
        jsHeapTotalSize: number;
      };
      reset: () => void;
    };
  }
}

const canvas = document.getElementById('gameCanvas');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Canvas not found');
const rawCtx = canvas.getContext('2d');
if (!rawCtx) throw new Error('2D context not available');
const ctx: CanvasRenderingContext2D = rawCtx;
const dpr = window.devicePixelRatio || 1;
canvas.width = 800 * dpr;
canvas.height = 600 * dpr;
ctx.scale(dpr, dpr);

const query = new URLSearchParams(location.search);
let interpolationDelay = Math.max(0, Math.min(1000, Number(query.get('delay') ?? 100) || 0));
const networkDelay = Math.max(0, Math.min(2000, Number(query.get('delay') ?? query.get('latency') ?? 100) || 0));
const networkJitter = Math.max(0, Math.min(1000, Number(query.get('jitter') ?? 15) || 0));
const networkDrop = Math.max(0, Math.min(1, Number(query.get('drop') ?? 0.02) || 0));
let dumbClient = query.get('dumb') === '1' || query.get('mode') === 'dumb';
let nondeterministicExperiment = query.get('nondeterministic') === '1';
const enablePerf = query.get('perf') === '1';
const PERF_BUF_SIZE = 10000;
const perfFrameDurations = new Float64Array(PERF_BUF_SIZE);
const perfFrameIntervals = new Float64Array(PERF_BUF_SIZE);
let perfIndex = 0;
let perfCount = 0;
let perfLongTaskCount = 0;
let perfLongAnimCount = 0;

if (enablePerf) {
  try {
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === 'longtask') perfLongTaskCount++;
        else if (entry.entryType === 'long-animation-frame') perfLongAnimCount++;
      }
    });
    const supported = PerformanceObserver.supportedEntryTypes ?? [];
    const types = [];
    if (supported.includes('longtask')) types.push('longtask');
    if (supported.includes('long-animation-frame')) types.push('long-animation-frame');
    if (types.length > 0) obs.observe({ entryTypes: types });
  } catch {}

  window.__perf = {
    getMetrics: () => {
      const valid = Math.min(perfCount, PERF_BUF_SIZE);
      const durs = Array.from(perfFrameDurations.subarray(0, valid)).sort((a, b) => a - b);
      const ints = Array.from(perfFrameIntervals.subarray(0, valid)).sort((a, b) => a - b);
      const p50 = durs[Math.floor(durs.length * 0.5)] ?? 0;
      const p95 = durs[Math.floor(durs.length * 0.95)] ?? 0;
      const p99 = durs[Math.floor(durs.length * 0.99)] ?? 0;
      const max = durs[durs.length - 1] ?? 0;
      const sum = durs.reduce((acc, v) => acc + v, 0);
      const avg = durs.length > 0 ? sum / durs.length : 0;
      const over16 = durs.filter((d) => d > 16.67).length;
      const mem = (performance as unknown as { memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number } }).memory;
      return {
        frameCount: perfCount,
        p50FrameMs: p50,
        p95FrameMs: p95,
        p99FrameMs: p99,
        maxFrameMs: max,
        avgFrameMs: avg,
        framesOver16ms: over16,
        p50IntervalMs: ints[Math.floor(ints.length * 0.5)] ?? 0,
        p95IntervalMs: ints[Math.floor(ints.length * 0.95)] ?? 0,
        p99IntervalMs: ints[Math.floor(ints.length * 0.99)] ?? 0,
        longTaskCount: perfLongTaskCount,
        longAnimFrameCount: perfLongAnimCount,
        jsHeapUsedSize: mem?.usedJSHeapSize ?? 0,
        jsHeapTotalSize: mem?.totalJSHeapSize ?? 0,
      };
    },
    reset: () => {
      perfIndex = 0;
      perfCount = 0;
      perfLongTaskCount = 0;
      perfLongAnimCount = 0;
    },
  };
}

function recordFramePerf(workMs: number, intervalMs: number) {
  if (!enablePerf) return;
  perfFrameDurations[perfIndex] = workMs;
  perfFrameIntervals[perfIndex] = intervalMs;
  perfIndex = (perfIndex + 1) % PERF_BUF_SIZE;
  perfCount++;
}

const input = createInput(window);
import { gameBus } from './events.js';
let ship = { x: 400, y: 300, vx: 0, vy: 0, angle: 0 };
let gameStarted = false;
let connection: RoomConnection | undefined;
let activeRoom: string | undefined;
let playerName: string | undefined;
let ownEntityId: EntityId | null = null;
let initialized = false;
let seq: Seq = asSeq(0);

if (query.get('e2e') === '1') {
  window.__e2e = {
    getSnapshot: () => {
      const ships: Array<{ id: number; x: number; y: number; angle: number; hp: number }> = [];
      for (const e of currentEntities) {
        if (e.kind === SHIP_KIND) {
          ships.push({
            id: e.id,
            x: e.x,
            y: e.y,
            angle: e.angle,
            hp: e.hp ?? 100,
          });
        }
      }
      return {
        ownEntityId: ownEntityId !== null ? ownEntityId : null,
        ownShip: initialized ? { x: ship.x, y: ship.y, angle: ship.angle } : null,
        ships,
      };
    },
  };
}
interface PendingInput {
  type: string;
  seq: Seq;
  thrust: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  fire: boolean;
}

interface SnapshotHistory {
  time: number;
  entities: readonly SnapshotEntity[];
}

interface PredictedBullet {
  seq: Seq;
  x: number;
  y: number;
  angle: number;
  expiresAt: number;
}

interface TrafficRecord {
  direction: string;
  bytes: number;
  time: number;
}

interface RenderableEntity {
  id: EntityId;
  kind: typeof SHIP_KIND | typeof BULLET_KIND | typeof ASTEROID_KIND | typeof PICKUP_KIND;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  hp?: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  expiresAt: number;
}

const particles: Particle[] = [];
const particlePool = new ObjectPool<Particle>(
  () => ({ x: 0, y: 0, vx: 0, vy: 0, color: '', expiresAt: 0 }),
  (p) => {
    p.x = 0;
    p.y = 0;
    p.vx = 0;
    p.vy = 0;
    p.color = '';
    p.expiresAt = 0;
  },
  128,
);

const predictedBulletPool = new ObjectPool<PredictedBullet>(
  () => ({ seq: asSeq(0), x: 0, y: 0, angle: 0, expiresAt: 0 }),
  (b) => {
    b.seq = asSeq(0);
    b.x = 0;
    b.y = 0;
    b.angle = 0;
    b.expiresAt = 0;
  },
  32,
);

function spawnExplosion(x: number, y: number, color = '#ffa726') {
  for (let i = 0; i < 12; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 40 + Math.random() * 120;
    const p = particlePool.acquire();
    p.x = x;
    p.y = y;
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
    p.color = color;
    p.expiresAt = performance.now() + 400 + Math.random() * 200;
    particles.push(p);
  }
}

let ownHp = 100;
let pendingInputs: PendingInput[] = [];
let snapshots: SnapshotHistory[] = [];
let currentEntities: readonly SnapshotEntity[] = [];
let lastSnapshotReceivedAt = 0;
let rtt: number | null = null;
let correctionMagnitude = 0;
let visualOffset = { x: 0, y: 0 };
let fireCooldown = 0;
let predictedBullets: PredictedBullet[] = [];
const traffic: TrafficRecord[] = [];

const AudioContextCls = window.AudioContext || window.webkitAudioContext || AudioContext;
const audioCtx = new AudioContextCls();

function playShootSound() {
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  
  osc.type = 'square';
  osc.frequency.setValueAtTime(880, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(110, audioCtx.currentTime + 0.1);
  
  gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
  
  osc.start(audioCtx.currentTime);
  osc.stop(audioCtx.currentTime + 0.1);
}

function playHurtSound() {
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(180, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(50, audioCtx.currentTime + 0.15);
  gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
  osc.start(audioCtx.currentTime);
  osc.stop(audioCtx.currentTime + 0.15);
}

let lastAsteroidSound = 0;
let lastPickupSound = 0;

function playPickupSound() {
  const nowMs = performance.now();
  if (nowMs - lastPickupSound < 150) return;
  lastPickupSound = nowMs;
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  const now = audioCtx.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((freq, idx) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now + idx * 0.04);
    gain.gain.setValueAtTime(0.06, now + idx * 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.04 + 0.12);
    osc.start(now + idx * 0.04);
    osc.stop(now + idx * 0.04 + 0.12);
  });
}

function playAsteroidExplodeSound() {
  const nowMs = performance.now();
  if (nowMs - lastAsteroidSound < 150) return;
  lastAsteroidSound = nowMs;
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(140, now);
  osc.frequency.exponentialRampToValueAtTime(32, now + 0.28);
  gain.gain.setValueAtTime(0.12, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
  osc.start(now);
  osc.stop(now + 0.28);
}

gameBus.addEventListener('fired', () => {
  console.log('Піу-піу!');
  playShootSound();
});

gameBus.addEventListener('pickup', () => {
  playPickupSound();
});

gameBus.addEventListener('asteroid_destroyed', () => {
  playAsteroidExplodeSound();
});

function syncControlsUI() {
  lobby.updateControls?.({ dumbClient, nondeterministicExperiment, interpolationDelay });
}

window.addEventListener('keydown', (event) => {
  if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName ?? '')) return;
  if (event.code === 'KeyP') {
    dumbClient = !dumbClient;
    syncControlsUI();
  } else if (event.code === 'KeyN') {
    nondeterministicExperiment = !nondeterministicExperiment;
    syncControlsUI();
  } else if (event.code === 'BracketLeft') {
    interpolationDelay = Math.max(0, interpolationDelay - 10);
    syncControlsUI();
  } else if (event.code === 'BracketRight') {
    interpolationDelay = Math.min(500, interpolationDelay + 10);
    syncControlsUI();
  }
});

const lobby = createLobby({
  onTogglePrediction: () => {
    dumbClient = !dumbClient;
    syncControlsUI();
  },
  onToggleNoise: () => {
    nondeterministicExperiment = !nondeterministicExperiment;
    syncControlsUI();
  },
  onChangeInterp: (delta) => {
    interpolationDelay = Math.max(0, Math.min(500, interpolationDelay + delta));
    syncControlsUI();
  },
  onJoin: ({ room, name }) => {
    activeRoom = room;
    playerName = name;
    lobby.setRoster([]);
    lobby.setJoined(true);
    lobby.setStatus('Підключення до кімнати...');
    connection?.close();
    const roomConnection = new RoomConnection();
    connection = roomConnection;
    roomConnection.addEventListener('open', () => {
      if (connection !== roomConnection) return;
      roomConnection.send({ type: 'join', room: activeRoom, name: playerName });
      lobby.setStatus(`Підключено до ${activeRoom}`);
      schedulePing(roomConnection);
    });
    roomConnection.addEventListener('close', () => {
      if (connection === roomConnection && activeRoom) {
        ownEntityId = null;
        initialized = false;
        pendingInputs = [];
        lobby.setStatus('З’єднання втрачено. Спроба перепідключення...');
      }
    });
    roomConnection.addEventListener('error', (event) => {
      if (connection === roomConnection && event instanceof CustomEvent && event.detail instanceof Error) {
        lobby.setStatus(event.detail.message);
      }
    });
    roomConnection.addEventListener('traffic', ({ detail }) => {
      traffic.push(detail);
    });
    roomConnection.addEventListener('message', ({ detail }) => {
      if (connection !== roomConnection) return;
      switch (detail.type) {
        case 'roster':
        case 'joined': {
          lobby.setRoster(detail.players ?? detail.roster ?? []);
          if (detail.type === 'joined') {
            lobby.setStatus(`У кімнаті ${activeRoom}`);
            ownEntityId = detail.entityId;
            initialized = false;
            pendingInputs = [];
            snapshots = [];
            for (const b of predictedBullets) predictedBulletPool.release(b);
            predictedBullets = [];
            for (const p of particles) particlePool.release(p);
            particles.length = 0;
            seq = asSeq(0);
          }
          lobby.refreshRooms();
          break;
        }
        case 'snapshot': {
          receiveSnapshot(detail);
          break;
        }
        case 'pong': {
          rtt = Math.max(0, performance.now() - detail.time);
          break;
        }
        case 'chat': {
          lobby.addMessage(detail.name ?? detail.from ?? 'Гравець', detail.text ?? '');
          break;
        }
        case 'event': {
          if (detail.event?.type === 'chat') {
            lobby.addMessage(detail.event.name ?? 'Гравець', detail.event.text ?? '');
          } else if (detail.event?.type === 'asteroid_destroyed') {
            gameBus.dispatchEvent(new Event('asteroid_destroyed'));
          } else if (detail.event?.type === 'pickup') {
            gameBus.dispatchEvent(new Event('pickup'));
          }
          break;
        }
        case 'error': {
          lobby.setJoined(false);
          lobby.setStatus(detail.message ?? 'Помилка протоколу');
          break;
        }
        default: {
          const _exhaustive: never = detail;
          return _exhaustive;
        }
      }
    });
    if (!gameStarted) {
      gameStarted = true;
      runGame();
    }
  },
  onLeave: () => {
    connection?.send({ type: 'leave' });
    connection?.close();
    connection = undefined;
    activeRoom = undefined;
    ownEntityId = null;
    initialized = false;
    pendingInputs = [];
    snapshots = [];
    for (const b of predictedBullets) predictedBulletPool.release(b);
    predictedBullets = [];
    for (const p of particles) particlePool.release(p);
    particles.length = 0;
    lobby.setJoined(false);
    lobby.setRoster([]);
    lobby.setStatus('Ви вийшли з кімнати');
    lobby.refreshRooms();
  },
  onChat: (text) => connection?.send({ type: 'chat', text }),
});

function schedulePing(roomConnection: RoomConnection) {
  if (connection !== roomConnection) return;
  const base = networkDelay + (Math.random() * 2 - 1) * networkJitter;
  setTimeout(() => {
    if (connection !== roomConnection) return;
    if (Math.random() >= networkDrop) {
      roomConnection.send({ v: 1, type: 'ping', time: performance.now() });
    }
    setTimeout(() => schedulePing(roomConnection), 1000);
  }, Math.max(0, base));
}

function retainUnconfirmedInputs(seq: Seq): PendingInput[] {
  let writeIdx = 0;
  for (let i = 0; i < pendingInputs.length; i++) {
    const item = pendingInputs[i]!;
    if (isSequenceAfter(item.seq, seq)) {
      pendingInputs[writeIdx++] = item;
    }
  }
  pendingInputs.length = writeIdx;
  return pendingInputs;
}

function receiveSnapshot(snapshot: SnapshotMessage | { entities?: readonly SnapshotEntity[]; lastProcessedSeq: Seq }) {
  const receivedAt = performance.now();
  lastSnapshotReceivedAt = receivedAt;
  const entities = Array.isArray(snapshot.entities) ? snapshot.entities : [];
  currentEntities = entities;
  snapshots.push({ time: receivedAt, entities });
  if (snapshots.length > 32) snapshots.shift();
  const ownShip = entities.find((entity: SnapshotEntity) => entity.id === ownEntityId && entity.kind === SHIP_KIND);
  if (ownShip) {
    const newHp = ownShip.hp ?? 100;
    if (initialized && newHp < ownHp) {
      spawnExplosion(ship.x, ship.y, '#f44336');
      playHurtSound();
    } else if (initialized && newHp > ownHp) {
      spawnExplosion(ship.x, ship.y, '#4caf50');
      playPickupSound();
    }
    ownHp = newHp;
    if (!initialized || dumbClient) {
      ship = { x: ownShip.x, y: ownShip.y, vx: ownShip.vx, vy: ownShip.vy, angle: ownShip.angle };
      retainUnconfirmedInputs(snapshot.lastProcessedSeq);
      visualOffset = { x: 0, y: 0 };
      initialized = true;
    } else {
      const prior = ship;
      const remainingInputs = retainUnconfirmedInputs(snapshot.lastProcessedSeq);
      let reconciled = { x: ownShip.x, y: ownShip.y, vx: ownShip.vx, vy: ownShip.vy, angle: ownShip.angle };
      for (const pending of remainingInputs) {
        reconciled = integrate(reconciled, pending, 1 / 30);
        if (nondeterministicExperiment) {
          reconciled.vx += (Math.random() - 0.5) * 80;
          reconciled.vy += (Math.random() - 0.5) * 80;
        }
      }
      const dx = shortestDelta(reconciled.x, prior.x, 800);
      const dy = shortestDelta(reconciled.y, prior.y, 600);
      visualOffset = { x: visualOffset.x + dx, y: visualOffset.y + dy };
      correctionMagnitude = Math.hypot(dx, dy);
      ship = reconciled;
    }
  }
  for (let i = predictedBullets.length - 1; i >= 0; i--) {
    const bullet = predictedBullets[i]!;
    if (bullet.expiresAt <= receivedAt) {
      predictedBulletPool.release(bullet);
      predictedBullets.splice(i, 1);
      continue;
    }
    let matched = false;
    for (let j = 0; j < entities.length; j++) {
      const serverBullet = entities[j]!;
      if (serverBullet.kind === BULLET_KIND) {
        if (Math.hypot(shortestDelta(serverBullet.x, bullet.x, 800), shortestDelta(serverBullet.y, bullet.y, 600)) < 70) {
          matched = true;
          break;
        }
      }
    }
    const confirmed = !isSequenceAfter(bullet.seq, snapshot.lastProcessedSeq);
    if (matched || confirmed) {
      predictedBulletPool.release(bullet);
      predictedBullets.splice(i, 1);
    }
  }
}

function shortestDelta(from: number, to: number, size: number) {
  return ((to - from + size / 2) % size + size) % size - size / 2;
}

function isSequenceAfter(sequence: number, previous: number) {
  const delta = (sequence - previous) >>> 0;
  return delta !== 0 && delta < 0x80000000;
}

function runGame() {
  const loop = createLoop({
    step: 1 / 30,
    simulate: (step) => {
      fireCooldown = Math.max(0, fireCooldown - step);
      const now = performance.now();
      for (let i = predictedBullets.length - 1; i >= 0; i--) {
        const bullet = predictedBullets[i]!;
        if (bullet.expiresAt <= now) {
          predictedBulletPool.release(bullet);
          predictedBullets.splice(i, 1);
          continue;
        }
        bullet.x = (bullet.x + Math.cos(bullet.angle) * 400 * step + 800) % 800;
        bullet.y = (bullet.y + Math.sin(bullet.angle) * 400 * step + 600) % 600;
      }

      // Перевірка попадання власної кулі в астероїд для негайного звуку вибуху
      for (let i = predictedBullets.length - 1; i >= 0; i--) {
        const bullet = predictedBullets[i]!;
        for (const entity of currentEntities) {
          if (entity.kind === ASTEROID_KIND) {
            const dx = Math.abs(entity.x - bullet.x);
            const dy = Math.abs(entity.y - bullet.y);
            if (Math.min(dx, 800 - dx) ** 2 + Math.min(dy, 600 - dy) ** 2 < 21 ** 2) {
              predictedBulletPool.release(bullet);
              predictedBullets.splice(i, 1);
              spawnExplosion(bullet.x, bullet.y, '#b0bec5');
              playAsteroidExplodeSound();
              break;
            }
          }
        }
      }

      // Перевірка підбору аптечки для негайного звуку підняття
      if (initialized && !dumbClient) {
        for (const entity of currentEntities) {
          if (entity.kind === PICKUP_KIND) {
            const dx = Math.abs(ship.x - entity.x);
            const dy = Math.abs(ship.y - entity.y);
            if (Math.min(dx, 800 - dx) ** 2 + Math.min(dy, 600 - dy) ** 2 < 27 ** 2) {
              playPickupSound();
              break;
            }
          }
        }
      }
      if (!connection || ownEntityId === null) return;
      seq = asSeq((seq + 1) >>> 0);
      const nextInput = {
        type: 'input',
        seq,
        thrust: input.isDown('ArrowUp') || input.isDown('KeyW'),
        turnLeft: input.isDown('ArrowLeft') || input.isDown('KeyA'),
        turnRight: input.isDown('ArrowRight') || input.isDown('KeyD'),
        fire: input.isDown('Space'),
      };
      pendingInputs.push(nextInput);
      if (initialized) {
        if (!dumbClient) {
          ship = integrate(ship, nextInput, step);
          if (nondeterministicExperiment) {
            ship.vx += (Math.random() - 0.5) * 80;
            ship.vy += (Math.random() - 0.5) * 80;
          }
          if (nextInput.fire && fireCooldown === 0) {
            const b = predictedBulletPool.acquire();
            b.seq = nextInput.seq;
            b.x = ship.x + Math.cos(ship.angle) * 20;
            b.y = ship.y + Math.sin(ship.angle) * 20;
            b.angle = ship.angle;
            b.expiresAt = performance.now() + 500;
            predictedBullets.push(b);
          }
        }
        if (nextInput.fire && fireCooldown === 0) {
          fireCooldown = 0.2;
          gameBus.dispatchEvent(new Event('fired'));
        }
      }
      connection.sendInput(nextInput);
    },
    render: (_alpha, stats) => {
      const startWork = enablePerf ? performance.now() : 0;
      drawFrame(stats);
      if (enablePerf) {
        const workMs = performance.now() - startWork;
        recordFramePerf(workMs, stats.frameMs);
      }
    },
  });
  loop.start();
}

const earlierEntitiesMap = new Map<EntityId, SnapshotEntity>();
const resultEntities: (SnapshotEntity | RenderableEntity)[] = [];

function interpolatedEntities(renderTime: number): readonly (SnapshotEntity | RenderableEntity)[] {
  if (snapshots.length === 0) return currentEntities;
  let before = snapshots[0]!;
  let after = snapshots[snapshots.length - 1]!;
  for (let index = 1; index < snapshots.length; index += 1) {
    const snap = snapshots[index]!;
    if (snap.time >= renderTime) {
      before = snapshots[index - 1]!;
      after = snap;
      break;
    }
  }
  if (before === after || after.time <= before.time) return before.entities;
  const alpha = Math.max(0, Math.min(1, (renderTime - before.time) / (after.time - before.time)));

  earlierEntitiesMap.clear();
  const beforeLen = before.entities.length;
  for (let i = 0; i < beforeLen; i++) {
    const e = before.entities[i]!;
    earlierEntitiesMap.set(e.id, e);
  }

  resultEntities.length = 0;
  const afterLen = after.entities.length;
  for (let i = 0; i < afterLen; i++) {
    const to = after.entities[i]!;
    const from = earlierEntitiesMap.get(to.id);
    if (from !== undefined) {
      earlierEntitiesMap.delete(to.id);
      resultEntities.push({
        id: to.id,
        kind: to.kind,
        x: from.x + shortestDelta(from.x, to.x, 800) * alpha,
        y: from.y + shortestDelta(from.y, to.y, 600) * alpha,
        vx: to.vx,
        vy: to.vy,
        angle: lerpAngle(from.angle, to.angle, alpha),
        hp: to.hp,
      });
    } else {
      if (alpha >= 0.5) {
        resultEntities.push(to);
      }
    }
  }

  if (alpha < 0.5) {
    for (const from of earlierEntitiesMap.values()) {
      resultEntities.push(from);
    }
  }

  return resultEntities;
}

function drawFrame(stats: LoopStats) {
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, 800, 600);
  const renderTime = performance.now() - interpolationDelay;
  for (const entity of interpolatedEntities(renderTime)) {
    if (entity.id === ownEntityId) continue;
    const color = entity.kind === SHIP_KIND
      ? `hsl(${entity.id * 67 % 360} 75% 70%)`
      : entity.kind === ASTEROID_KIND
      ? '#b0bec5'
      : entity.kind === PICKUP_KIND
      ? '#4caf50'
      : '#ffd54f';
    drawEntity(entity, color);
  }
  for (const bullet of predictedBullets) {
    ctx.fillStyle = '#ffd54f';
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  if (initialized && ownEntityId !== null) {
    const displayed: RenderableEntity = {
      id: ownEntityId,
      kind: SHIP_KIND,
      x: (ship.x + visualOffset.x + 800) % 800,
      y: (ship.y + visualOffset.y + 600) % 600,
      vx: ship.vx,
      vy: ship.vy,
      angle: ship.angle,
      hp: ownHp,
    };
    drawEntity(displayed, '#fff');
  }

  // Draw particles
  const now = performance.now();
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]!;
    if (p.expiresAt <= now) {
      particlePool.release(p);
      particles.splice(i, 1);
      continue;
    }
    p.x = (p.x + p.vx * (stats.frameMs / 1000) + 800) % 800;
    p.y = (p.y + p.vy * (stats.frameMs / 1000) + 600) % 600;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  visualOffset.x *= Math.exp(-stats.frameMs / 100);
  visualOffset.y *= Math.exp(-stats.frameMs / 100);
  drawNetgraph(stats);
}

function drawEntity(
  entity: {
    x: number;
    y: number;
    kind: typeof SHIP_KIND | typeof BULLET_KIND | typeof ASTEROID_KIND | typeof PICKUP_KIND;
    angle?: number;
    hp?: number;
  },
  color: string,
) {
  ctx.save();
  ctx.translate(entity.x, entity.y);
  switch (entity.kind) {
    case SHIP_KIND: {
      ctx.rotate(entity.angle ?? 0);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(15, 0);
      ctx.lineTo(-10, 10);
      ctx.lineTo(-10, -10);
      ctx.closePath();
      ctx.stroke();

      // Health bar above ship
      ctx.rotate(-(entity.angle ?? 0));
      const currentHp = Math.max(0, Math.min(100, entity.hp ?? 100));
      const barW = 32;
      const barH = 4;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(-barW / 2, -22, barW, barH);
      ctx.strokeStyle = '#444';
      ctx.lineWidth = 1;
      ctx.strokeRect(-barW / 2, -22, barW, barH);
      const fillW = (currentHp / 100) * barW;
      ctx.fillStyle = currentHp > 50 ? '#4caf50' : currentHp > 25 ? '#ffeb3b' : '#f44336';
      ctx.fillRect(-barW / 2, -22, fillW, barH);
      break;
    }
    case BULLET_KIND: {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, 3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case ASTEROID_KIND: {
      ctx.rotate(entity.angle ?? 0);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      const points = 8;
      const baseRadius = 18;
      for (let i = 0; i < points; i++) {
        const theta = (i / points) * Math.PI * 2;
        const r = baseRadius * (i % 2 === 0 ? 1 : 0.76);
        const px = Math.cos(theta) * r;
        const py = Math.sin(theta) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case PICKUP_KIND: {
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(-8, -8, 16, 16);
      ctx.fillRect(-6, -2, 12, 4);
      ctx.fillRect(-2, -6, 4, 12);
      break;
    }
    default: {
      const _exhaustive: never = entity.kind;
      return _exhaustive;
    }
  }
  ctx.restore();
}

function drawNetgraph(stats: LoopStats) {
  const now = performance.now();
  while (traffic.length && (traffic[0]?.time ?? 0) < now - 1000) traffic.shift();
  const bytesIn = traffic.filter((entry) => entry.direction === 'in').reduce((sum, entry) => sum + entry.bytes, 0);
  const bytesOut = traffic.filter((entry) => entry.direction === 'out').reduce((sum, entry) => sum + entry.bytes, 0);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.82)';
  ctx.fillRect(10, 10, 260, 190);
  ctx.strokeStyle = '#52665d';
  ctx.strokeRect(10, 10, 260, 190);
  ctx.fillStyle = '#a7ff83';
  ctx.font = '12px monospace';
  const modeText = dumbClient ? 'DUMB (NO PREDICT)' : 'PREDICTION';
  const noiseText = nondeterministicExperiment ? ' [NOISE ACTIVE]' : '';
  const hpBlocks = Math.max(0, Math.min(10, Math.round(ownHp / 10)));
  const hpBar = `${'█'.repeat(hpBlocks)}${'░'.repeat(10 - hpBlocks)}`;
  const lines = [
    `HP: [${hpBar}] ${ownHp} / 100`,
    `RTT: ${rtt === null ? '--' : `${rtt.toFixed(0)} ms`}`,
    `Snapshot age: ${lastSnapshotReceivedAt ? `${(now - lastSnapshotReceivedAt).toFixed(0)} ms` : '--'}`,
    `Traffic: ${(bytesIn / 1024).toFixed(2)} / ${(bytesOut / 1024).toFixed(2)} KB/s in/out`,
    `Pending inputs: ${pendingInputs.length}`,
    `Correction: ${correctionMagnitude.toFixed(2)} px`,
    `Interp delay: ${interpolationDelay} ms (keys: [ / ])`,
    `${modeText}${noiseText} | ${connection?.codec ?? 'offline'} | ${stats.fps} FPS`,
  ];
  lines.forEach((line, index) => ctx.fillText(line, 18, 29 + index * 20));
}

syncControlsUI();
