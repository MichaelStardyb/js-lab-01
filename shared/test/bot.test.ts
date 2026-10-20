import { describe, it, expect } from 'vitest';
import { decideBotInput, type BotView } from '../sim/bot.js';
import { SHIP_KIND, ASTEROID_KIND } from '../protocol/binaryCodec.js';
import { mulberry32 } from '../sim/prng.js';
import { asEntityId } from '../protocol/schema.js';

describe('shared/sim/bot decideBotInput', () => {
  const rng = mulberry32(42);

  it('steers away from nearby asteroid hazards', () => {
    const view: BotView = {
      self: { id: 1, x: 400, y: 300, angle: 0, vx: 0, vy: 0 },
      entities: [
        { id: asEntityId(2), kind: ASTEROID_KIND, x: 430, y: 300, angle: 0, vx: 0, vy: 0, hp: 25 },
      ],
    };
    const input = decideBotInput(view, rng);
    expect(input.thrust).toBe(true);
    // Asteroid is to the right (angle 0), away is PI (~3.14). Turn right or left to avoid
    expect(input.turnLeft || input.turnRight).toBe(true);
  });

  it('targets closest enemy and fires when within cone', () => {
    const view: BotView = {
      self: { id: 1, x: 400, y: 300, angle: 0, vx: 0, vy: 0 },
      entities: [
        // Enemy directly in front along angle 0
        { id: asEntityId(2), kind: SHIP_KIND, x: 480, y: 300, angle: Math.PI, vx: 0, vy: 0, hp: 100 },
      ],
    };
    const input = decideBotInput(view, () => 0.5);
    // Since enemy is directly in front, fire should be true
    expect(input.fire).toBe(true);
  });

  it('is deterministic when provided a seeded PRNG', () => {
    const view: BotView = {
      self: { id: 1, x: 200, y: 150, angle: 1.2, vx: 10, vy: 5 },
      entities: [
        { id: asEntityId(2), kind: SHIP_KIND, x: 500, y: 400, angle: 0, vx: 0, vy: 0, hp: 100 },
      ],
    };
    const rng1 = mulberry32(12345);
    const rng2 = mulberry32(12345);
    const i1 = decideBotInput(view, rng1);
    const i2 = decideBotInput(view, rng2);
    expect(i1).toEqual(i2);
  });

  it('wanders safely when no enemies or hazards are present', () => {
    const view: BotView = {
      self: { id: 1, x: 400, y: 300, angle: 0, vx: 0, vy: 0 },
      entities: [],
    };
    const input = decideBotInput(view, () => 0.5);
    expect(typeof input.thrust).toBe('boolean');
    expect(typeof input.turnLeft).toBe('boolean');
    expect(typeof input.turnRight).toBe('boolean');
    expect(typeof input.fire).toBe('boolean');
  });
});
