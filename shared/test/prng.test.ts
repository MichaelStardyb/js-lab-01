import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../sim/prng.js';

describe('shared/sim/prng mulberry32', () => {
  it('is strictly deterministic: identical seed produces identical sequence', () => {
    const rng1 = mulberry32(42);
    const rng2 = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      expect(rng1()).toBe(rng2());
    }
  });

  it('different seeds produce different sequences', () => {
    const rng1 = mulberry32(100);
    const rng2 = mulberry32(200);
    const s1 = Array.from({ length: 10 }, () => rng1());
    const s2 = Array.from({ length: 10 }, () => rng2());
    expect(s1).not.toEqual(s2);
  });

  it('returns values in range [0, 1)', () => {
    const rng = mulberry32(0xDEADBEEF);
    for (let i = 0; i < 1000; i++) {
      const val = rng();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });

  it('handles negative or 32-bit overflow seeds via unsigned shift', () => {
    const rngNeg = mulberry32(-1);
    const rngMax = mulberry32(0xFFFFFFFF);
    expect(rngNeg()).toBe(rngMax());
  });
});
