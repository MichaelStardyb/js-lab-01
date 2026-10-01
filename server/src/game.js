import { DEFAULT_ARENA } from 'shared/sim/arena';
import { integrate } from 'shared/sim/ship';
import { mulberry32 } from 'shared/sim/prng';
import { createFixedTicker } from './loop.js';
import { encodeSnapshot } from 'shared/protocol/binaryCodec';

const SHIP_KIND = 1;
const BULLET_KIND = 2;
const BULLET_SPEED = 400;
const FIRE_COOLDOWN = 0.2;

function isSequenceAfter(sequence, previous) {
  const delta = (sequence - previous) >>> 0;
  return delta !== 0 && delta < 0x80000000;
}

export class RoomGame {
  #send;
  #players = new Map();
  #bullets = new Map();
  #nextEntityId = 1;
  #tick = 0;
  #random;
  #ticker;

  constructor({ send, now = () => performance.now(), randomSeed = 0xD06F19 } = {}) {
    this.#send = send;
    this.#random = mulberry32(randomSeed);
    this.#ticker = createFixedTicker({ tick: (dt) => this.#step(dt), now });
  }

  addPlayer(socket, player) {
    const angle = this.#random() * Math.PI * 2;
    const state = {
      id: this.#allocateId(),
      owner: player.id,
      x: this.#random() * DEFAULT_ARENA.width,
      y: this.#random() * DEFAULT_ARENA.height,
      vx: 0,
      vy: 0,
      angle,
      fireCooldown: 0,
      lastProcessedSeq: 0,
      lastInput: { seq: 0, thrust: false, turnLeft: false, turnRight: false, fire: false },
      queued: [],
      player,
    };
    this.#players.set(socket, state);
    this.#ticker.start();
    return state.id;
  }

  removePlayer(socket) {
    const state = this.#players.get(socket);
    if (!state) return;
    this.#players.delete(socket);
    for (const [id, bullet] of this.#bullets) {
      if (bullet.owner === state.owner) this.#bullets.delete(id);
    }
    if (this.#players.size === 0) this.#ticker.stop();
  }

  close() {
    this.#ticker.stop();
    this.#players.clear();
    this.#bullets.clear();
  }

  getStats() {
    return this.#ticker.getStats();
  }

  receiveInput(socket, input) {
    const state = this.#players.get(socket);
    const previousSequence = state?.queued.at(-1)?.seq ?? state?.lastProcessedSeq;
    if (!state || !isSequenceAfter(input.seq, previousSequence)) return;
    state.queued.push(input);
    if (state.queued.length > 256) state.queued.shift();
  }

  #allocateId() {
    const id = this.#nextEntityId;
    this.#nextEntityId = (this.#nextEntityId % 0xFFFF) + 1;
    return id;
  }

  #step(dt) {
    if (this.#players.size === 0) return;
    this.#tick = (this.#tick + 1) >>> 0;
    for (const player of this.#players.values()) {
      if (player.queued.length > 0) {
        const inputs = player.queued.splice(0);
        for (const input of inputs) {
          if (isSequenceAfter(input.seq, player.lastProcessedSeq)) {
            player.lastInput = input;
            player.lastProcessedSeq = input.seq;
          }
        }
      }
      const next = integrate(player, player.lastInput, dt, DEFAULT_ARENA);
      Object.assign(player, next);
      player.fireCooldown = Math.max(0, player.fireCooldown - dt);
      if (player.lastInput.fire && player.fireCooldown === 0) {
        this.#spawnBullet(player);
        player.fireCooldown = FIRE_COOLDOWN;
      }
    }

    for (const [id, bullet] of this.#bullets) {
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      bullet.x = ((bullet.x % DEFAULT_ARENA.width) + DEFAULT_ARENA.width) % DEFAULT_ARENA.width;
      bullet.y = ((bullet.y % DEFAULT_ARENA.height) + DEFAULT_ARENA.height) % DEFAULT_ARENA.height;
      bullet.ttl -= dt;
      if (bullet.ttl <= 0) this.#bullets.delete(id);
      else {
        for (const target of this.#players.values()) {
          if (target.owner === bullet.owner) continue;
          const dx = Math.abs(target.x - bullet.x);
          const dy = Math.abs(target.y - bullet.y);
          if (Math.min(dx, DEFAULT_ARENA.width - dx) ** 2 + Math.min(dy, DEFAULT_ARENA.height - dy) ** 2 < 18 ** 2) {
            target.x = this.#random() * DEFAULT_ARENA.width;
            target.y = this.#random() * DEFAULT_ARENA.height;
            target.vx = 0;
            target.vy = 0;
            this.#bullets.delete(id);
            break;
          }
        }
      }
    }

    const entities = this.#snapshotEntities();
    for (const [socket, player] of this.#players) {
      const packet = {
        type: 'snapshot',
        tick: this.#tick,
        lastProcessedSeq: player.lastProcessedSeq,
        entities,
      };
      this.#send(socket, socket.codec === 'binary' ? encodeSnapshot(packet) : { v: 1, ...packet }, {
        dropWhenBuffered: true,
        simulated: true,
      });
    }
  }

  #spawnBullet(player) {
    const id = this.#allocateId();
    const speedX = Math.cos(player.angle) * BULLET_SPEED + player.vx;
    const speedY = Math.sin(player.angle) * BULLET_SPEED + player.vy;
    this.#bullets.set(id, {
      id,
      kind: BULLET_KIND,
      owner: player.owner,
      x: (player.x + Math.cos(player.angle) * 20) % DEFAULT_ARENA.width,
      y: (player.y + Math.sin(player.angle) * 20) % DEFAULT_ARENA.height,
      vx: speedX,
      vy: speedY,
      angle: player.angle,
      ttl: 2,
    });
  }

  #snapshotEntities() {
    const entities = [];
    for (const player of this.#players.values()) {
      entities.push({
        id: player.id,
        kind: SHIP_KIND,
        x: player.x,
        y: player.y,
        vx: player.vx,
        vy: player.vy,
        angle: player.angle,
      });
    }
    for (const bullet of this.#bullets.values()) {
      entities.push({
        id: bullet.id,
        kind: bullet.kind,
        x: bullet.x,
        y: bullet.y,
        vx: bullet.vx,
        vy: bullet.vy,
        angle: bullet.angle,
      });
    }
    return entities;
  }
}
