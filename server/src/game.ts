import type { MetricsCollector } from './metrics.js';
import { DEFAULT_ARENA } from 'shared/sim/arena.js';
import { integrate } from 'shared/sim/ship.js';
import { mulberry32 } from 'shared/sim/prng.js';
import { ObjectPool } from 'shared/sim/pool.js';
import { createFixedTicker, type FixedTicker } from './loop.js';
import {
  encodeSnapshot,
  SHIP_KIND,
  BULLET_KIND,
  ASTEROID_KIND,
  PICKUP_KIND,
  type SnapshotEntity,
} from 'shared/protocol/binaryCodec.js';
import { type EntityId, type Tick, type Seq, asEntityId, asTick, asSeq } from 'shared/protocol/schema.js';
import type { Player } from './rooms.js';

const BULLET_SPEED = 400;
const FIRE_COOLDOWN = 0.2;

export interface GameSocket {
  codec?: string;
  [key: string]: unknown;
}

type ShipInput = {
  seq: Seq;
  thrust: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  fire: boolean;
};

type PlayerState = {
  id: EntityId;
  owner: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  hp: number;
  fireCooldown: number;
  lastProcessedSeq: Seq;
  lastInput: ShipInput;
  queued: ShipInput[];
  player: Player;
};

type BulletState = {
  id: EntityId;
  kind: typeof BULLET_KIND;
  owner: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  ttl: number;
};

type AsteroidState = {
  id: EntityId;
  kind: typeof ASTEROID_KIND;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  angularVelocity: number;
  radius: number;
};

type PickupState = {
  id: EntityId;
  kind: typeof PICKUP_KIND;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  active: boolean;
  respawnCooldown: number;
};

type SendOptions = { dropWhenBuffered?: boolean; simulated?: boolean };

function isSequenceAfter(sequence: number, previous: number): boolean {
  const delta = (sequence - previous) >>> 0;
  return delta !== 0 && delta < 0x80000000;
}

export class RoomGame {
  #send: (socket: GameSocket, value: unknown, options?: SendOptions) => void;
  #players = new Map<GameSocket, PlayerState>();
  #bullets = new Map<EntityId, BulletState>();
  #bulletPool = new ObjectPool<BulletState>(
    () => ({
      id: asEntityId(0),
      kind: BULLET_KIND,
      owner: '',
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      angle: 0,
      ttl: 0,
    }),
    (bullet) => {
      bullet.owner = '';
      bullet.x = 0;
      bullet.y = 0;
      bullet.vx = 0;
      bullet.vy = 0;
      bullet.angle = 0;
      bullet.ttl = 0;
    },
    32,
  );
  #asteroids = new Map<EntityId, AsteroidState>();
  #pickups = new Map<EntityId, PickupState>();
  #nextEntityId = 1;
  #tick: Tick = asTick(0);
  #random: () => number;
  #ticker: FixedTicker;
  #metrics?: MetricsCollector;

  constructor({
    send,
    now = () => performance.now(),
    randomSeed = 0xD06F19,
    metrics,
  }: {
    metrics?: MetricsCollector;
    send: (socket: GameSocket, value: unknown, options?: SendOptions) => void;
    now?: () => number;
    randomSeed?: number;
  } = { send: () => {} }) {
    this.#send = send;
    this.#random = mulberry32(randomSeed);
    this.#metrics = metrics;
    this.#initWorldEntities();
    this.#ticker = createFixedTicker({ tick: (dt) => this.#step(dt), now });
  }

  #initWorldEntities(): void {
    for (let i = 0; i < 4; i++) {
      const id = this.#allocateId();
      const angle = this.#random() * Math.PI * 2;
      const speed = 15 + this.#random() * 25;
      this.#asteroids.set(id, {
        id,
        kind: ASTEROID_KIND,
        x: this.#random() * DEFAULT_ARENA.width,
        y: this.#random() * DEFAULT_ARENA.height,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        angle: this.#random() * Math.PI * 2,
        angularVelocity: (this.#random() - 0.5) * 1.5,
        radius: 18,
      });
    }

    for (let i = 0; i < 2; i++) {
      const id = this.#allocateId();
      this.#pickups.set(id, {
        id,
        kind: PICKUP_KIND,
        x: 150 + this.#random() * (DEFAULT_ARENA.width - 300),
        y: 100 + this.#random() * (DEFAULT_ARENA.height - 200),
        vx: 0,
        vy: 0,
        angle: 0,
        active: true,
        respawnCooldown: 0,
      });
    }
  }

  addPlayer(socket: GameSocket, player: Player): EntityId {
    const angle = this.#random() * Math.PI * 2;
    const state: PlayerState = {
      id: this.#allocateId(),
      owner: player.id,
      x: this.#random() * DEFAULT_ARENA.width,
      y: this.#random() * DEFAULT_ARENA.height,
      vx: 0,
      vy: 0,
      angle,
      hp: 100,
      fireCooldown: 0,
      lastProcessedSeq: asSeq(0),
      lastInput: { seq: asSeq(0), thrust: false, turnLeft: false, turnRight: false, fire: false },
      queued: [],
      player,
    };
    this.#players.set(socket, state);
    this.#ticker.start();
    return state.id;
  }

  #despawnBullet(id: EntityId, bullet: BulletState): void {
    this.#bullets.delete(id);
    this.#bulletPool.release(bullet);
  }

  removePlayer(socket: GameSocket): void {
    const state = this.#players.get(socket);
    if (!state) return;
    this.#players.delete(socket);
    for (const [id, bullet] of this.#bullets) {
      if (bullet.owner === state.owner) this.#despawnBullet(id, bullet);
    }
    if (this.#players.size === 0) this.#ticker.stop();
  }

  close(): void {
    this.#ticker.stop();
    this.#players.clear();
    for (const [id, bullet] of this.#bullets) {
      this.#bulletPool.release(bullet);
    }
    this.#bullets.clear();
    this.#asteroids.clear();
    this.#pickups.clear();
  }

  getStats() {
    return this.#ticker.getStats();
  }

  receiveInput(socket: GameSocket, input: { seq: Seq | number; thrust: boolean; turnLeft: boolean; turnRight: boolean; fire: boolean }): void {
    const state = this.#players.get(socket);
    const inputSeq = asSeq(input.seq);
    const previousSequence = state?.queued.at(-1)?.seq ?? state?.lastProcessedSeq;
    if (!state || !isSequenceAfter(inputSeq, previousSequence ?? 0)) return;
    state.queued.push({ ...input, seq: inputSeq });
    if (state.queued.length > 256) state.queued.shift();
  }

  #allocateId(): EntityId {
    const id = asEntityId(this.#nextEntityId);
    this.#nextEntityId = (this.#nextEntityId % 0xFFFF) + 1;
    return id;
  }

  #step(dt: number): void {
    if (this.#players.size === 0) return;
    const stepStartTime = performance.now();
    this.#tick = asTick((this.#tick + 1) >>> 0);
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
      player.x = next.x;
      player.y = next.y;
      player.vx = next.vx;
      player.vy = next.vy;
      player.angle = next.angle;
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
      if (bullet.ttl <= 0) this.#despawnBullet(id, bullet);
      else {
        for (const target of this.#players.values()) {
          if (target.owner === bullet.owner) continue;
          const dx = Math.abs(target.x - bullet.x);
          const dy = Math.abs(target.y - bullet.y);
          if (Math.min(dx, DEFAULT_ARENA.width - dx) ** 2 + Math.min(dy, DEFAULT_ARENA.height - dy) ** 2 < 18 ** 2) {
            target.hp = Math.max(0, target.hp - 25);
            this.#despawnBullet(id, bullet);
            if (target.hp <= 0) {
              target.hp = 100;
              target.x = this.#random() * DEFAULT_ARENA.width;
              target.y = this.#random() * DEFAULT_ARENA.height;
              target.vx = 0;
              target.vy = 0;
            }
            break;
          }
        }
      }
    }

    // Update asteroids
    for (const asteroid of this.#asteroids.values()) {
      asteroid.x = (((asteroid.x + asteroid.vx * dt) % DEFAULT_ARENA.width) + DEFAULT_ARENA.width) % DEFAULT_ARENA.width;
      asteroid.y = (((asteroid.y + asteroid.vy * dt) % DEFAULT_ARENA.height) + DEFAULT_ARENA.height) % DEFAULT_ARENA.height;
      asteroid.angle += asteroid.angularVelocity * dt;
    }

    // Update pickups
    for (const pickup of this.#pickups.values()) {
      if (!pickup.active) {
        pickup.respawnCooldown -= dt;
        if (pickup.respawnCooldown <= 0) {
          pickup.active = true;
          pickup.x = 100 + this.#random() * (DEFAULT_ARENA.width - 200);
          pickup.y = 80 + this.#random() * (DEFAULT_ARENA.height - 160);
        }
      }
    }

    // Collisions: Bullet vs Asteroid (Збиття астероїда з 1 пострілу)
    for (const [id, bullet] of this.#bullets) {
      for (const asteroid of this.#asteroids.values()) {
        const dx = Math.abs(asteroid.x - bullet.x);
        const dy = Math.abs(asteroid.y - bullet.y);
        if (Math.min(dx, DEFAULT_ARENA.width - dx) ** 2 + Math.min(dy, DEFAULT_ARENA.height - dy) ** 2 < (asteroid.radius + 3) ** 2) {
          this.#despawnBullet(id, bullet);
          // Повідомляємо гравця, чия куля знищила астероїд
          for (const [playerSocket, playerState] of this.#players) {
            if (playerState.owner === bullet.owner) {
              this.#send(playerSocket, { v: 0, type: 'event', event: { type: 'asteroid_destroyed' } });
              break;
            }
          }
          // Знищення астероїда: переспавн на новому місці
          asteroid.x = this.#random() * DEFAULT_ARENA.width;
          asteroid.y = this.#random() * DEFAULT_ARENA.height;
          const newAngle = this.#random() * Math.PI * 2;
          const speed = 15 + this.#random() * 25;
          asteroid.vx = Math.cos(newAngle) * speed;
          asteroid.vy = Math.sin(newAngle) * speed;
          break;
        }
      }
    }

    // Collisions: Ship vs Asteroid (-25 HP гравцю)
    for (const player of this.#players.values()) {
      for (const asteroid of this.#asteroids.values()) {
        const dx = Math.abs(player.x - asteroid.x);
        const dy = Math.abs(player.y - asteroid.y);
        if (Math.min(dx, DEFAULT_ARENA.width - dx) ** 2 + Math.min(dy, DEFAULT_ARENA.height - dy) ** 2 < (15 + asteroid.radius) ** 2) {
          player.hp = Math.max(0, player.hp - 25);
          if (player.hp <= 0) {
            player.hp = 100;
            player.x = this.#random() * DEFAULT_ARENA.width;
            player.y = this.#random() * DEFAULT_ARENA.height;
            player.vx = 0;
            player.vy = 0;
          }
          // Астероїд переспавнюється на інші координати
          asteroid.x = this.#random() * DEFAULT_ARENA.width;
          asteroid.y = this.#random() * DEFAULT_ARENA.height;
          const newAngle = this.#random() * Math.PI * 2;
          const speed = 15 + this.#random() * 25;
          asteroid.vx = Math.cos(newAngle) * speed;
          asteroid.vy = Math.sin(newAngle) * speed;
          break;
        }
      }
    }

    // Collisions: Ship vs Pickup (+50 HP гравцю)
    for (const [socket, player] of this.#players) {
      for (const pickup of this.#pickups.values()) {
        if (!pickup.active) continue;
        const dx = Math.abs(player.x - pickup.x);
        const dy = Math.abs(player.y - pickup.y);
        if (Math.min(dx, DEFAULT_ARENA.width - dx) ** 2 + Math.min(dy, DEFAULT_ARENA.height - dy) ** 2 < (15 + 12) ** 2) {
          player.hp = Math.min(100, player.hp + 50);
          pickup.active = false;
          pickup.respawnCooldown = 6;
          this.#send(socket, { v: 0, type: 'event', event: { type: 'pickup' } });
          break;
        }
      }
    }

    const entities = this.#snapshotEntities();
    let cachedBinarySnapshot: ArrayBuffer | null = null;

    for (const [socket, player] of this.#players) {
      if (socket.codec === 'binary') {
        if (!cachedBinarySnapshot) {
          cachedBinarySnapshot = encodeSnapshot({
            tick: this.#tick,
            lastProcessedSeq: asSeq(0),
            entities,
          });
        }
        const clientBuffer = cachedBinarySnapshot.slice(0);
        new DataView(clientBuffer).setUint32(6, player.lastProcessedSeq, true);
        this.#send(socket, clientBuffer, {
          dropWhenBuffered: true,
          simulated: true,
        });
      } else {
        const packet = {
          v: 1,
          type: 'snapshot' as const,
          tick: this.#tick,
          lastProcessedSeq: player.lastProcessedSeq,
          entities,
        };
        this.#send(socket, packet, {
          dropWhenBuffered: true,
          simulated: true,
        });
      }
    }
    if (this.#metrics) {
      const stepDuration = performance.now() - stepStartTime;
      const stats = this.#ticker.getStats();
      this.#metrics.recordTick(stepDuration, stats.jitterMs.last);
    }
  }

  #spawnBullet(player: PlayerState): void {
    const id = this.#allocateId();
    const speedX = Math.cos(player.angle) * BULLET_SPEED + player.vx;
    const speedY = Math.sin(player.angle) * BULLET_SPEED + player.vy;
    const bullet = this.#bulletPool.acquire();
    bullet.id = id;
    bullet.kind = BULLET_KIND;
    bullet.owner = player.owner;
    bullet.x = (player.x + Math.cos(player.angle) * 20) % DEFAULT_ARENA.width;
    bullet.y = (player.y + Math.sin(player.angle) * 20) % DEFAULT_ARENA.height;
    bullet.vx = speedX;
    bullet.vy = speedY;
    bullet.angle = player.angle;
    bullet.ttl = 2;
    this.#bullets.set(id, bullet);
  }

  #snapshotEntities(): SnapshotEntity[] {
    const entities: SnapshotEntity[] = [];
    for (const player of this.#players.values()) {
      entities.push({
        id: player.id,
        kind: SHIP_KIND,
        x: player.x,
        y: player.y,
        vx: player.vx,
        vy: player.vy,
        angle: player.angle,
        hp: player.hp,
      });
    }
    for (const bullet of this.#bullets.values()) {
      entities.push({
        id: bullet.id,
        kind: BULLET_KIND,
        x: bullet.x,
        y: bullet.y,
        vx: bullet.vx,
        vy: bullet.vy,
        angle: bullet.angle,
        hp: 1,
      });
    }
    for (const asteroid of this.#asteroids.values()) {
      entities.push({
        id: asteroid.id,
        kind: ASTEROID_KIND,
        x: asteroid.x,
        y: asteroid.y,
        vx: asteroid.vx,
        vy: asteroid.vy,
        angle: asteroid.angle,
        hp: 25,
      });
    }
    for (const pickup of this.#pickups.values()) {
      if (pickup.active) {
        entities.push({
          id: pickup.id,
          kind: PICKUP_KIND,
          x: pickup.x,
          y: pickup.y,
          vx: pickup.vx,
          vy: pickup.vy,
          angle: pickup.angle,
          hp: 50,
        });
      }
    }
    return entities;
  }
}
