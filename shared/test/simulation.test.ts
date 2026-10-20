import test from 'node:test';
import assert from 'node:assert/strict';
import { integrate } from '../sim/ship.js';
import { mulberry32 } from '../sim/prng.js';

test('shared simulation imports in Node and produces deterministic state over 500 steps', () => {
  function run() {
    const random = mulberry32(123456);
    let ship = { x: 400, y: 300, vx: 0, vy: 0, angle: 0 };
    for (let step = 0; step < 500; step += 1) {
      const input = {
        thrust: random() > 0.3,
        turnLeft: step % 4 === 0,
        turnRight: step % 7 === 0,
      };
      ship = integrate(ship, input, 1 / 30);
    }
    return ship;
  }
  assert.deepEqual(run(), run());
});
