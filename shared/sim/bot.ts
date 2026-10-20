import { DEFAULT_ARENA, type Arena } from './arena.js';
import { SHIP_KIND, ASTEROID_KIND, type SnapshotEntity } from '../protocol/binaryCodec.js';
import type { ShipInput } from './ship.js';

export interface BotSelfState {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly vx: number;
  readonly vy: number;
}

export interface BotView {
  readonly self: BotSelfState;
  readonly entities: readonly SnapshotEntity[];
  readonly arena?: Arena;
}

function shortestDelta(from: number, to: number, size: number): number {
  return ((to - from + size / 2) % size + size) % size - size / 2;
}

function normalizeAngle(angle: number): number {
  const fullTurn = Math.PI * 2;
  return ((angle % fullTurn) + fullTurn) % fullTurn;
}

export function decideBotInput(view: BotView, rng: () => number = Math.random): ShipInput {
  const arena = view.arena ?? DEFAULT_ARENA;
  const self = view.self;

  // 1. Check for immediate asteroid hazards nearby
  let hazardAngle: number | null = null;
  let minHazardDistSq = 60 * 60;

  for (const entity of view.entities) {
    if (entity.kind === ASTEROID_KIND) {
      const dx = shortestDelta(self.x, entity.x, arena.width);
      const dy = shortestDelta(self.y, entity.y, arena.height);
      const distSq = dx * dx + dy * dy;
      if (distSq < minHazardDistSq) {
        minHazardDistSq = distSq;
        hazardAngle = Math.atan2(dy, dx);
      }
    }
  }

  // 2. If hazard is close, steer away from it
  if (hazardAngle !== null) {
    const avoidAngle = normalizeAngle(hazardAngle + Math.PI);
    const angleDiff = shortestDelta(self.angle, avoidAngle, Math.PI * 2);
    return {
      thrust: true,
      turnLeft: angleDiff < -0.1,
      turnRight: angleDiff > 0.1,
      fire: rng() > 0.8,
    };
  }

  // 3. Find closest enemy ship
  let closestEnemy: SnapshotEntity | null = null;
  let minEnemyDistSq = Infinity;

  for (const entity of view.entities) {
    if (entity.kind === SHIP_KIND && entity.id !== self.id) {
      const dx = shortestDelta(self.x, entity.x, arena.width);
      const dy = shortestDelta(self.y, entity.y, arena.height);
      const distSq = dx * dx + dy * dy;
      if (distSq < minEnemyDistSq) {
        minEnemyDistSq = distSq;
        closestEnemy = entity;
      }
    }
  }

  // 4. If enemy found, steer towards it and fire in cone
  if (closestEnemy) {
    const dx = shortestDelta(self.x, closestEnemy.x, arena.width);
    const dy = shortestDelta(self.y, closestEnemy.y, arena.height);
    const targetAngle = Math.atan2(dy, dx);
    const angleDiff = shortestDelta(self.angle, targetAngle, Math.PI * 2);

    const inFiringCone = Math.abs(angleDiff) < 0.35;
    const shouldThrust = minEnemyDistSq > 150 * 150 || rng() > 0.3;

    return {
      thrust: shouldThrust,
      turnLeft: angleDiff < -0.1,
      turnRight: angleDiff > 0.1,
      fire: inFiringCone && rng() > 0.2,
    };
  }

  // 5. Default wander behavior
  return {
    thrust: rng() > 0.3,
    turnLeft: rng() > 0.7,
    turnRight: rng() < 0.3,
    fire: rng() > 0.85,
  };
}
