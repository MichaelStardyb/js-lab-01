import { DEFAULT_ARENA, type Arena, wrapAngle, wrapPosition } from './arena.js';

const ROTATION_SPEED = 4;
const ACCELERATION = 300;
const DAMPING_PER_60_HZ_STEP = 0.98;

export type ShipState = {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly angle: number;
};

export type ShipInput = {
  readonly thrust: boolean;
  readonly turnLeft: boolean;
  readonly turnRight: boolean;
  readonly fire?: boolean;
};

export function integrate(ship: ShipState, input: ShipInput, dt: number, arena: Arena = DEFAULT_ARENA): ShipState {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError('dt must be a non-negative finite number');
  const angle = wrapAngle(
    ship.angle + (Number(Boolean(input.turnRight)) - Number(Boolean(input.turnLeft))) * ROTATION_SPEED * dt,
  );
  const acceleration = input.thrust ? ACCELERATION * dt : 0;
  let vx = ship.vx + Math.cos(angle) * acceleration;
  let vy = ship.vy + Math.sin(angle) * acceleration;
  const damping = DAMPING_PER_60_HZ_STEP ** (dt * 60);
  vx *= damping;
  vy *= damping;
  const rawX = ship.x + vx * dt;
  const rawY = ship.y + vy * dt;
  const x = ((rawX % arena.width) + arena.width) % arena.width;
  const y = ((rawY % arena.height) + arena.height) % arena.height;
  return { ...ship, x, y, vx, vy, angle };
}
