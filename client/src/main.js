import { createLoop } from './loop.js';
import { createInput } from './input.js';
import { lerpAngle } from 'shared/sim/arena';
import { integrate } from 'shared/sim/ship';
import { RoomConnection } from './connection.js';
import { createLobby } from './lobby.js';
import './style.css';

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const dpr = window.devicePixelRatio || 1;
canvas.width = 800 * dpr;
canvas.height = 600 * dpr;
ctx.scale(dpr, dpr);

const query = new URLSearchParams(location.search);
const interpolationDelay = Math.max(0, Math.min(1000, Number(query.get('delay') ?? 100) || 0));
const networkDelay = Math.max(0, Math.min(2000, Number(query.get('delay') ?? query.get('latency') ?? 100) || 0));
const networkJitter = Math.max(0, Math.min(1000, Number(query.get('jitter') ?? 15) || 0));
const networkDrop = Math.max(0, Math.min(1, Number(query.get('drop') ?? 0.02) || 0));
const dumbClient = query.get('dumb') === '1' || query.get('mode') === 'dumb';
const nondeterministicExperiment = query.get('nondeterministic') === '1';
const input = createInput(window);
const gameBus = new EventTarget();
let ship = { x: 400, y: 300, vx: 0, vy: 0, angle: 0 };
let connection;
let activeRoom;
let playerName;
let gameStarted = false;
let ownEntityId = null;
let initialized = false;
let seq = 0;
let pendingInputs = [];
let snapshots = [];
let currentEntities = [];
let lastSnapshotReceivedAt = 0;
let rtt = null;
let correctionMagnitude = 0;
let visualOffset = { x: 0, y: 0 };
let fireCooldown = 0;
let predictedBullets = [];
const traffic = [];

gameBus.addEventListener('fired', () => console.log('Піу-піу!'));

const lobby = createLobby({
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
      if (connection === roomConnection) lobby.setStatus(event.detail.message);
    });
    roomConnection.addEventListener('traffic', ({ detail }) => {
      traffic.push(detail);
    });
    roomConnection.addEventListener('message', ({ detail }) => {
      if (connection !== roomConnection) return;
      if (detail.type === 'roster' || detail.type === 'joined') {
        lobby.setRoster(detail.players ?? detail.roster ?? []);
        if (detail.type === 'joined') {
          lobby.setStatus(`У кімнаті ${activeRoom}`);
          ownEntityId = detail.entityId;
          initialized = false;
          pendingInputs = [];
          snapshots = [];
          predictedBullets = [];
          seq = 0;
        }
        lobby.refreshRooms();
      } else if (detail.type === 'snapshot') {
        receiveSnapshot(detail);
      } else if (detail.type === 'pong') {
        rtt = Math.max(0, performance.now() - detail.time);
      } else if (detail.type === 'chat') {
        lobby.addMessage(detail.name ?? detail.from ?? 'Гравець', detail.text ?? '');
      } else if (detail.type === 'event' && detail.event?.type === 'chat') {
        lobby.addMessage(detail.event.name ?? 'Гравець', detail.event.text ?? '');
      } else if (detail.type === 'error') {
        lobby.setJoined(false);
        lobby.setStatus(detail.message ?? 'Помилка протоколу');
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

function schedulePing(roomConnection) {
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

function receiveSnapshot(snapshot) {
  const receivedAt = performance.now();
  lastSnapshotReceivedAt = receivedAt;
  const entities = Array.isArray(snapshot.entities) ? snapshot.entities : [];
  currentEntities = entities;
  snapshots.push({ time: receivedAt, entities });
  if (snapshots.length > 32) snapshots.shift();
  const ownShip = entities.find((entity) => entity.id === ownEntityId && entity.kind === 1);
  if (ownShip) {
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
  const authoritativeBullets = entities.filter((entity) => entity.kind === 2);
  predictedBullets = predictedBullets.filter((bullet) => {
    if (bullet.expiresAt <= receivedAt) return false;
    const matched = authoritativeBullets.some((serverBullet) => (
      Math.hypot(shortestDelta(serverBullet.x, bullet.x, 800), shortestDelta(serverBullet.y, bullet.y, 600)) < 70
    ));
    const confirmed = !isSequenceAfter(bullet.seq, snapshot.lastProcessedSeq);
    return !matched && !confirmed;
  });
}

function shortestDelta(from, to, size) {
  return ((to - from + size / 2) % size + size) % size - size / 2;
}

function isSequenceAfter(sequence, previous) {
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
      if (!connection || ownEntityId === null) return;
      seq = (seq + 1) >>> 0;
      const nextInput = {
        seq,
        thrust: input.isDown('ArrowUp') || input.isDown('KeyW'),
        turnLeft: input.isDown('ArrowLeft') || input.isDown('KeyA'),
        turnRight: input.isDown('ArrowRight') || input.isDown('KeyD'),
        fire: input.isDown('Space'),
      };
      pendingInputs.push(nextInput);
      if (!dumbClient && initialized) {
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

function interpolatedEntities(renderTime) {
  if (snapshots.length === 0) return currentEntities;
  let before = snapshots[0];
  let after = snapshots[snapshots.length - 1];
  for (let index = 1; index < snapshots.length; index += 1) {
    if (snapshots[index].time >= renderTime) {
      before = snapshots[index - 1];
      after = snapshots[index];
      break;
    }
  }
  if (before === after || after.time <= before.time) return before.entities;
  const alpha = Math.max(0, Math.min(1, (renderTime - before.time) / (after.time - before.time)));
  const earlier = new Map(before.entities.map((entity) => [entity.id, entity]));
  const later = new Map(after.entities.map((entity) => [entity.id, entity]));
  const ids = new Set([...earlier.keys(), ...later.keys()]);
  const result = [];
  for (const id of ids) {
    const from = earlier.get(id);
    const to = later.get(id);
    if (!from || !to) {
      const visible = from ? alpha < 0.5 : alpha >= 0.5;
      if (visible) result.push(from ?? to);
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

function drawFrame(stats) {
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, 800, 600);
  const renderTime = performance.now() - interpolationDelay;
  for (const entity of interpolatedEntities(renderTime)) {
    if (entity.id === ownEntityId) continue;
    drawEntity(entity, entity.kind === 1 ? `hsl(${entity.id * 67 % 360} 75% 70%)` : 'yellow');
  }
  for (const bullet of predictedBullets) {
    ctx.fillStyle = '#ffd54f';
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  if (initialized && ownEntityId !== null) {
    const displayed = {
      id: ownEntityId,
      kind: 1,
      x: (ship.x + visualOffset.x + 800) % 800,
      y: (ship.y + visualOffset.y + 600) % 600,
      angle: ship.angle,
    };
    drawEntity(displayed, '#fff');
  }
  visualOffset.x *= Math.exp(-stats.frameMs / 100);
  visualOffset.y *= Math.exp(-stats.frameMs / 100);
  drawNetgraph(stats);
}

function drawEntity(entity, color) {
  ctx.save();
  ctx.translate(entity.x, entity.y);
  if (entity.kind === 1) {
    ctx.rotate(entity.angle);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(15, 0);
    ctx.lineTo(-10, 10);
    ctx.lineTo(-10, -10);
    ctx.closePath();
    ctx.stroke();
  } else if (entity.kind === 2) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawNetgraph(stats) {
  const now = performance.now();
  while (traffic.length && traffic[0].time < now - 1000) traffic.shift();
  const bytesIn = traffic.filter((entry) => entry.direction === 'in').reduce((sum, entry) => sum + entry.bytes, 0);
  const bytesOut = traffic.filter((entry) => entry.direction === 'out').reduce((sum, entry) => sum + entry.bytes, 0);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.76)';
  ctx.fillRect(10, 10, 240, 144);
  ctx.fillStyle = '#a7ff83';
  ctx.font = '12px monospace';
  const lines = [
    `RTT: ${rtt === null ? '--' : `${rtt.toFixed(0)} ms`}`,
    `Snapshot age: ${lastSnapshotReceivedAt ? `${(now - lastSnapshotReceivedAt).toFixed(0)} ms` : '--'}`,
    `Traffic: ${(bytesIn / 1024).toFixed(2)} / ${(bytesOut / 1024).toFixed(2)} KB/s in/out`,
    `Pending inputs: ${pendingInputs.length}`,
    `Correction: ${correctionMagnitude.toFixed(2)} px`,
    `${dumbClient ? 'DUMB' : 'PREDICTION'} | ${connection?.codec ?? 'offline'} | ${stats.fps} FPS`,
  ];
  lines.forEach((line, index) => ctx.fillText(line, 18, 29 + index * 20));
}
