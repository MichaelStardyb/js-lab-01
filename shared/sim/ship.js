import { DEFAULT_ARENA, wrapAngle, wrapPosition } from './arena.js';

const ROTATION_SPEED = 4;
const ACCELERATION = 300;
const DAMPING_PER_60_HZ_STEP = 0.98;

export function integrate(ship, input, dt, arena = DEFAULT_ARENA) {
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
  const position = wrapPosition({ x: ship.x + vx * dt, y: ship.y + vy * dt }, arena);
  return { ...ship, x: position.x, y: position.y, vx, vy, angle };
}
