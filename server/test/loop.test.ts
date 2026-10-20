import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixedTicker } from '../src/loop.js';

test('fixed ticker schedules against an absolute deadline and clamps overload', () => {
  let time = 0;
  let task: { callback: () => void; delay: number } | undefined;
  const ticks: number[] = [];
  const ticker = createFixedTicker({
    now: () => time,
    schedule: (callback, delay) => { task = { callback, delay }; return task; },
    cancel: () => {},
    tick: (dt) => ticks.push(dt),
  });
  ticker.start();
  assert.ok(Math.abs(task!.delay - 1000 / 30) < 0.000001);
  time = 34;
  task!.callback();
  assert.equal(ticks.length, 1);
  assert.ok(task!.delay > 32 && task!.delay < 34);
  time = 500;
  task!.callback();
  assert.equal(ticks.length, 2);
  assert.ok(Math.abs(task!.delay - 1000 / 30) < 0.000001);
  ticker.stop();
});

test('fixed ticker drops accumulated lag after a slow simulation step', () => {
  let time = 0;
  let task: { callback: () => void; delay: number } | undefined;
  const ticker = createFixedTicker({
    now: () => time,
    schedule: (callback, delay) => { task = { callback, delay }; return task; },
    cancel: () => {},
    tick: () => { time += 200; },
  });
  ticker.start();
  time = 1000 / 30;
  task!.callback();
  assert.ok(Math.abs(task!.delay - 1000 / 30) < 0.000001);
  ticker.stop();
});

test('fixed ticker measures tick duration and jitter statistics', () => {
  let time = 0;
  let task: { callback: () => void; delay: number } | undefined;
  const ticker = createFixedTicker({
    now: () => time,
    schedule: (callback, delay) => { task = { callback, delay }; return task; },
    cancel: () => {},
    tick: () => { time += 5; },
  });
  ticker.start();
  time = 35; // scheduled was 33.333 -> jitter is 1.667ms
  task!.callback();
  const stats = ticker.getStats();
  assert.equal(stats.ticks, 1);
  assert.equal(stats.durationMs.last, 5);
  assert.ok(Math.abs(stats.jitterMs.last - (35 - 1000 / 30)) < 0.001);
  ticker.stop();
});
