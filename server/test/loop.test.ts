import { describe, it, expect } from 'vitest';
import { createFixedTicker } from '../src/loop.js';

describe('server/loop createFixedTicker', () => {
  it('schedules against an absolute deadline and clamps overload', () => {
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
    expect(Math.abs(task!.delay - 1000 / 30)).toBeLessThan(0.000001);
    time = 34;
    task!.callback();
    expect(ticks.length).toBe(1);
    expect(task!.delay).toBeGreaterThan(32);
    expect(task!.delay).toBeLessThan(34);
    time = 500;
    task!.callback();
    expect(ticks.length).toBe(2);
    expect(Math.abs(task!.delay - 1000 / 30)).toBeLessThan(0.000001);
    ticker.stop();
  });

  it('drops accumulated lag after a slow simulation step', () => {
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
    expect(Math.abs(task!.delay - 1000 / 30)).toBeLessThan(0.000001);
    ticker.stop();
  });

  it('measures tick duration and jitter statistics', () => {
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
    expect(stats.ticks).toBe(1);
    expect(stats.durationMs.last).toBe(5);
    expect(Math.abs(stats.jitterMs.last - (35 - 1000 / 30))).toBeLessThan(0.001);
    ticker.stop();
  });
});
