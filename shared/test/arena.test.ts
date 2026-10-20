import { describe, it, expect } from 'vitest';
import { DEFAULT_ARENA, wrapPosition, wrapAngle, lerpAngle } from '../sim/arena.js';

describe('shared/sim/arena', () => {
  it('DEFAULT_ARENA has width 800 and height 600', () => {
    expect(DEFAULT_ARENA.width).toBe(800);
    expect(DEFAULT_ARENA.height).toBe(600);
  });

  it('wrapPosition wraps negative coordinates to positive arena space', () => {
    expect(wrapPosition({ x: -1, y: 601 })).toEqual({ x: 799, y: 1 });
    expect(wrapPosition({ x: -800, y: -600 })).toEqual({ x: 0, y: 0 });
    expect(wrapPosition({ x: -0.5, y: -0.5 })).toEqual({ x: 799.5, y: 599.5 });
  });

  it('wrapPosition leaves coordinates inside bounds unchanged', () => {
    expect(wrapPosition({ x: 400, y: 300 })).toEqual({ x: 400, y: 300 });
    expect(wrapPosition({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it('wrapPosition wraps values beyond width and height', () => {
    expect(wrapPosition({ x: 800, y: 600 })).toEqual({ x: 0, y: 0 });
    expect(wrapPosition({ x: 850, y: 620 })).toEqual({ x: 50, y: 20 });
    expect(wrapPosition({ x: 1650, y: 1250 })).toEqual({ x: 50, y: 50 });
  });

  it('wrapAngle wraps within [0, 2*PI)', () => {
    const fullTurn = Math.PI * 2;
    expect(wrapAngle(0)).toBeCloseTo(0);
    expect(wrapAngle(fullTurn)).toBeCloseTo(0);
    expect(wrapAngle(-0.1)).toBeCloseTo(fullTurn - 0.1);
    expect(wrapAngle(fullTurn + 1)).toBeCloseTo(1);
    expect(wrapAngle(-fullTurn * 3 + 0.5)).toBeCloseTo(0.5);
  });

  it('lerpAngle interpolates along the shortest arc across 0/2PI boundary', () => {
    const halfway = lerpAngle(6.2, 0.1, 0.5);
    const fullTurn = Math.PI * 2;
    expect(halfway < 0.05 || halfway > fullTurn - 0.05).toBe(true);
  });

  it('lerpAngle returns from when alpha=0 and to when alpha=1', () => {
    expect(lerpAngle(1.0, 2.0, 0)).toBeCloseTo(1.0);
    expect(lerpAngle(1.0, 2.0, 1)).toBeCloseTo(2.0);
    expect(lerpAngle(0.5, 1.5, 0.5)).toBeCloseTo(1.0);
  });
});
