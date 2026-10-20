import { createLoop, type LoopStats } from './loop.js';
import { createInput } from './input.js';
import { lerpAngle } from 'shared/sim/arena';
import { integrate } from 'shared/sim/ship';
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

function spawnExplosion(x: number, y: number, color = '#ffa726') {
  for (let i = 0; i < 12; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 40 + Math.random() * 120;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      expiresAt: performance.now() + 400 + Math.random() * 200,
    });
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
            predictedBullets = [];
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
    predictedBullets = [];
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
      pendingInputs = pendingInputs.filter((item) => isSequenceAfter(item.seq, snapshot.lastProcessedSeq));
      visualOffset = { x: 0, y: 0 };
      initialized = true;
    } else {
      const prior = ship;
      const remainingInputs = pendingInputs.filter((item) => isSequenceAfter(item.seq, snapshot.lastProcessedSeq));
      let reconciled = { x: ownShip.x, y: ownShip.y, vx: ownShip.vx, vy: ownShip.vy, angle: ownShip.angle };
      for (const pending of remainingInputs) {
        reconciled = integrate(reconciled, pending, 1 / 30);
        if (nondeterministicExperiment) {
          reconciled.vx += (Math.random() - 0.5) * 80;
          reconciled.vy += (Math.random() - 0.5) * 80;
        }
      }
      pendingInputs = remainingInputs;
      const dx = shortestDelta(reconciled.x, prior.x, 800);
      const dy = shortestDelta(reconciled.y, prior.y, 600);
      visualOffset = { x: visualOffset.x + dx, y: visualOffset.y + dy };
      correctionMagnitude = Math.hypot(dx, dy);
      ship = reconciled;
    }
  }
  const authoritativeBullets = entities.filter((entity: SnapshotEntity) => entity.kind === BULLET_KIND);
  predictedBullets = predictedBullets.filter((bullet) => {
    if (bullet.expiresAt <= receivedAt) return false;
    const matched = authoritativeBullets.some((serverBullet: SnapshotEntity) => (
      Math.hypot(shortestDelta(serverBullet.x, bullet.x, 800), shortestDelta(serverBullet.y, bullet.y, 600)) < 70
    ));
    const confirmed = !isSequenceAfter(bullet.seq, snapshot.lastProcessedSeq);
    return !matched && !confirmed;
  });
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
      predictedBullets = predictedBullets.filter((bullet) => bullet.expiresAt > performance.now());
      for (const bullet of predictedBullets) {
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
            predictedBullets.push({
              seq: nextInput.seq,
              x: ship.x + Math.cos(ship.angle) * 20,
              y: ship.y + Math.sin(ship.angle) * 20,
              angle: ship.angle,
              expiresAt: performance.now() + 500,
            });
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
      drawFrame(stats);
    },
  });
  loop.start();
}

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
  const earlier = new Map<EntityId, SnapshotEntity>(before.entities.map((entity: SnapshotEntity) => [entity.id, entity]));
  const later = new Map<EntityId, SnapshotEntity>(after.entities.map((entity: SnapshotEntity) => [entity.id, entity]));
  const ids = new Set<EntityId>([...earlier.keys(), ...later.keys()]);
  const result: (SnapshotEntity | RenderableEntity)[] = [];
  for (const id of ids) {
    const from = earlier.get(id);
    const to = later.get(id);
    if (!from || !to) {
      const visible = from ? alpha < 0.5 : alpha >= 0.5;
      if (visible) {
        const entity = from ?? to;
        if (entity) result.push(entity);
      }
      continue;
    }
    result.push({
      ...to,
      x: from.x + shortestDelta(from.x, to.x, 800) * alpha,
      y: from.y + shortestDelta(from.y, to.y, 600) * alpha,
      angle: lerpAngle(from.angle, to.angle, alpha),
    });
  }
  return result;
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
