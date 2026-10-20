import { describe, it, expect } from 'vitest';
import { Vector2 } from '../src/sim/vector.js';

describe('client/sim/vector Vector2', () => {
  it('constructs with immutable x and y properties', () => {
    const v = new Vector2(3, 4);
    expect(v.x).toBe(3);
    expect(v.y).toBe(4);
  });

  it('add returns new Vector2 without mutating operands', () => {
    const a = new Vector2(1, 2);
    const b = new Vector2(3, 4);
    const c = a.add(b);
    expect(c.x).toBe(4);
    expect(c.y).toBe(6);
    expect(a.x).toBe(1);
    expect(a.y).toBe(2);
    expect(b.x).toBe(3);
    expect(b.y).toBe(4);
  });

  it('sub returns new Vector2 representing difference', () => {
    const a = new Vector2(10, 20);
    const b = new Vector2(3, 5);
    const c = a.sub(b);
    expect(c.x).toBe(7);
    expect(c.y).toBe(15);
  });

  it('scale multiplies coordinates by scalar', () => {
    const v = new Vector2(2, -3);
    const scaled = v.scale(2.5);
    expect(scaled.x).toBe(5);
    expect(scaled.y).toBe(-7.5);
  });

  it('length returns Euclidean magnitude', () => {
    const v = new Vector2(3, 4);
    expect(v.length()).toBe(5);

    const zero = new Vector2(0, 0);
    expect(zero.length()).toBe(0);
  });

  it('normalize returns unit vector in same direction', () => {
    const v = new Vector2(0, 5);
    const u = v.normalize();
    expect(u.x).toBe(0);
    expect(u.y).toBe(1);
    expect(u.length()).toBeCloseTo(1);
  });

  it('normalize of zero vector returns (0, 0) without NaN', () => {
    const zero = new Vector2(0, 0);
    const norm = zero.normalize();
    expect(norm.x).toBe(0);
    expect(norm.y).toBe(0);
    expect(Number.isNaN(norm.x)).toBe(false);
  });

  it('fromAngle constructs unit vector from radians', () => {
    const right = Vector2.fromAngle(0);
    expect(right.x).toBeCloseTo(1);
    expect(right.y).toBeCloseTo(0);

    const down = Vector2.fromAngle(Math.PI / 2);
    expect(down.x).toBeCloseTo(0);
    expect(down.y).toBeCloseTo(1);
  });
});
