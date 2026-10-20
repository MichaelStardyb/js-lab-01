import test from 'node:test';
import assert from 'node:assert/strict';
import { lerpAngle, wrapPosition } from '../sim/arena.js';

test('arena wrap-around and shortest-path angle interpolation are continuous', () => {
  assert.deepEqual(wrapPosition({ x: -1, y: 601 }), { x: 799, y: 1 });
  const halfway = lerpAngle(6.2, 0.1, 0.5);
  assert.ok(halfway < 0.01 || halfway > Math.PI * 2 - 0.01);
});
