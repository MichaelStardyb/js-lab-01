import { describe, it, expect } from 'vitest';
import { integrate, type ShipState, type ShipInput } from '../sim/ship.js';
import { DEFAULT_ARENA } from '../sim/arena.js';

describe('shared/sim/ship integrate', () => {
  const initialShip: ShipState = Object.freeze({
    x: 400,
    y: 300,
    vx: 0,
    vy: 0,
    angle: 0,
  });

  it('rejects negative or non-finite dt with RangeError', () => {
    const input: ShipInput = { thrust: false, turnLeft: false, turnRight: false };
    expect(() => integrate(initialShip, input, -0.01)).toThrow(RangeError);
    expect(() => integrate(initialShip, input, NaN)).toThrow(RangeError);
    expect(() => integrate(initialShip, input, Infinity)).toThrow(RangeError);
  });

  it('zero input leaves ship stationary when initial velocity is zero', () => {
    const input: ShipInput = { thrust: false, turnLeft: false, turnRight: false };
    const next = integrate(initialShip, input, 1 / 60);
    expect(next.x).toBe(400);
    expect(next.y).toBe(300);
    expect(next.vx).toBe(0);
    expect(next.vy).toBe(0);
    expect(next.angle).toBe(0);
  });

  it('thrust applies acceleration along ship angle', () => {
    const input: ShipInput = { thrust: true, turnLeft: false, turnRight: false };
    const dt = 1 / 60;
    const next = integrate(initialShip, input, dt);
    // ACCELERATION = 300, dt = 1/60 => 5 * 0.98 = 4.9
    expect(next.vx).toBeCloseTo(300 * dt * 0.98, 4);
    expect(next.vy).toBeCloseTo(0, 4);
    expect(next.x).toBeGreaterThan(400);
    expect(next.y).toBe(300);
  });

  it('turnRight increases angle and turnLeft decreases angle', () => {
    const dt = 1 / 60;
    const turningRight = integrate(initialShip, { thrust: false, turnLeft: false, turnRight: true }, dt);
    expect(turningRight.angle).toBeCloseTo(4 * dt, 4);

    const turningLeft = integrate(initialShip, { thrust: false, turnLeft: true, turnRight: false }, dt);
    expect(turningLeft.angle).toBeCloseTo(Math.PI * 2 - 4 * dt, 4);
  });

  it('pressing both turnLeft and turnRight cancels out rotation', () => {
    const dt = 1 / 60;
    const next = integrate(initialShip, { thrust: false, turnLeft: true, turnRight: true }, dt);
    expect(next.angle).toBe(0);
  });

  it('damping applies continuously according to dt*60 exponent', () => {
    const movingShip: ShipState = { x: 400, y: 300, vx: 100, vy: 0, angle: 0 };
    const input: ShipInput = { thrust: false, turnLeft: false, turnRight: false };
    const next1 = integrate(movingShip, input, 1 / 60);
    expect(next1.vx).toBeCloseTo(98, 4);

    const nextHalf = integrate(movingShip, input, 0.5 / 60);
    expect(nextHalf.vx).toBeCloseTo(100 * (0.98 ** 0.5), 4);
  });

  it('does not mutate input ship or input object', () => {
    const ship: ShipState = Object.freeze({ x: 100, y: 100, vx: 50, vy: 50, angle: 1 });
    const input: ShipInput = Object.freeze({ thrust: true, turnLeft: false, turnRight: true, fire: false });
    const result = integrate(ship, input, 1 / 30);
    expect(result).not.toBe(ship);
    expect(ship.x).toBe(100);
    expect(input.thrust).toBe(true);
  });

  it('wraps position around arena boundaries', () => {
    const nearRightEdge: ShipState = { x: 799, y: 300, vx: 100, vy: 0, angle: 0 };
    const next = integrate(nearRightEdge, { thrust: false, turnLeft: false, turnRight: false }, 0.1);
    expect(next.x).toBeLessThan(100);
    expect(next.x).toBeGreaterThanOrEqual(0);

    const nearLeftEdge: ShipState = { x: 1, y: 300, vx: -100, vy: 0, angle: 0 };
    const nextLeft = integrate(nearLeftEdge, { thrust: false, turnLeft: false, turnRight: false }, 0.1);
    expect(nextLeft.x).toBeGreaterThan(700);
    expect(nextLeft.x).toBeLessThan(800);
  });

  it('is strictly deterministic: identical inputs yield bitwise identical outputs', () => {
    const ship: ShipState = { x: 234.56, y: 567.89, vx: -42.1, vy: 18.7, angle: 2.14 };
    const input: ShipInput = { thrust: true, turnLeft: false, turnRight: true };
    const run1 = integrate(ship, input, 0.03333333333333333);
    const run2 = integrate(ship, input, 0.03333333333333333);
    expect(run1).toEqual(run2);
    expect(Object.is(run1.x, run2.x)).toBe(true);
    expect(Object.is(run1.y, run2.y)).toBe(true);
    expect(Object.is(run1.vx, run2.vx)).toBe(true);
    expect(Object.is(run1.vy, run2.vy)).toBe(true);
    expect(Object.is(run1.angle, run2.angle)).toBe(true);
  });

  it('supports custom arena dimensions', () => {
    const customArena = { width: 100, height: 100 };
    const ship: ShipState = { x: 99, y: 50, vx: 50, vy: 0, angle: 0 };
    const next = integrate(ship, { thrust: false, turnLeft: false, turnRight: false }, 0.1, customArena);
    expect(next.x).toBeLessThan(100);
  });
});
