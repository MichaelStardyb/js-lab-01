import { describe, it, expect } from 'vitest';
import { createLoop } from '../src/loop.js';

describe('client/loop createLoop', () => {
  it('runs exactly 60 steps per simulated second at 60 FPS refresh rate', () => {
    let nowTime = 0;
    let scheduledCallback: ((time: number) => void) | null = null;
    let nextRafId = 1;

    let stepCount = 0;
    let renderCount = 0;

    const loop = createLoop({
      step: 1 / 60,
      simulate: () => { stepCount++; },
      render: () => { renderCount++; },
      now: () => nowTime,
      raf: (cb) => {
        scheduledCallback = cb;
        return nextRafId++;
      },
      caf: () => { scheduledCallback = null; },
    });

    loop.start();
    // Simulate 60 frames, each 1000/60 ms
    const frameDuration = 1000 / 60;
    for (let frame = 1; frame <= 60; frame++) {
      nowTime = frame * frameDuration;
      if (scheduledCallback !== null) {
        const cb: (time: number) => void = scheduledCallback;
        scheduledCallback = null;
        cb(nowTime);
      }
    }

    expect(stepCount).toBe(60);
    expect(renderCount).toBe(61); // 1 initial on start + 60 frames
  });

  it('runs exactly 60 steps per simulated second at 144 FPS high refresh rate', () => {
    let nowTime = 0;
    let scheduledCallback: ((time: number) => void) | null = null;
    let nextRafId = 1;
    let stepCount = 0;

    const loop = createLoop({
      step: 1 / 60,
      simulate: () => { stepCount++; },
      render: () => {},
      now: () => nowTime,
      raf: (cb) => {
        scheduledCallback = cb;
        return nextRafId++;
      },
      caf: () => { scheduledCallback = null; },
    });

    loop.start();
    const frameDuration = 1000 / 144;
    for (let frame = 1; frame <= 144; frame++) {
      nowTime = frame * frameDuration;
      if (scheduledCallback !== null) {
        const cb: (time: number) => void = scheduledCallback;
        scheduledCallback = null;
        cb(nowTime);
      }
    }

    expect(stepCount).toBe(60);
  });

  it('runs ~60 steps per simulated second at 30 FPS low refresh rate', () => {
    let nowTime = 0;
    let scheduledCallback: ((time: number) => void) | null = null;
    let nextRafId = 1;
    let stepCount = 0;

    const loop = createLoop({
      step: 1 / 60,
      simulate: () => { stepCount++; },
      render: () => {},
      now: () => nowTime,
      raf: (cb) => {
        scheduledCallback = cb;
        return nextRafId++;
      },
      caf: () => { scheduledCallback = null; },
    });

    loop.start();
    const frameDuration = 1000 / 30;
    for (let frame = 1; frame <= 30; frame++) {
      nowTime = frame * frameDuration;
      if (scheduledCallback !== null) {
        const cb: (time: number) => void = scheduledCallback;
        scheduledCallback = null;
        cb(nowTime);
      }
    }

    expect(stepCount).toBe(60);
  });

  it('clamps large time jumps (spiral of death protection) to max dt = 0.25s', () => {
    let nowTime = 0;
    let scheduledCallback: ((time: number) => void) | null = null;
    let stepCount = 0;

    const loop = createLoop({
      step: 1 / 60,
      simulate: () => { stepCount++; },
      render: () => {},
      now: () => nowTime,
      raf: (cb) => { scheduledCallback = cb; return 1; },
      caf: () => { scheduledCallback = null; },
    });

    loop.start();
    // Simulate a 5-second lag spike (5000 ms)
    nowTime = 5000;
    if (scheduledCallback !== null) {
      const cb: (time: number) => void = scheduledCallback;
      scheduledCallback = null;
      cb(nowTime);
    }

    // With dt clamped to 0.25s: 0.25 / (1/60) = 15 steps max
    expect(stepCount).toBe(15);
  });

  it('provides interpolation alpha in range [0, 1) to render callback', () => {
    let nowTime = 0;
    let scheduledCallback: ((time: number) => void) | null = null;
    const alphas: number[] = [];

    const loop = createLoop({
      step: 1 / 60,
      simulate: () => {},
      render: (alpha) => { alphas.push(alpha); },
      now: () => nowTime,
      raf: (cb) => { scheduledCallback = cb; return 1; },
      caf: () => { scheduledCallback = null; },
    });

    loop.start();
    // Render 10 frames with non-multiple dt (11ms per frame)
    for (let i = 1; i <= 10; i++) {
      nowTime += 11;
      if (scheduledCallback !== null) {
        const cb: (time: number) => void = scheduledCallback;
        scheduledCallback = null;
        cb(nowTime);
      }
    }

    for (const alpha of alphas) {
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThan(1.000001);
    }
  });

  it('stop cancels scheduled frame and prevents further executions', () => {
    let cancelledId: number | null = null;
    let scheduledCallback: ((time: number) => void) | null = null;

    const loop = createLoop({
      step: 1 / 60,
      simulate: () => {},
      render: () => {},
      now: () => 0,
      raf: (cb) => { scheduledCallback = cb; return 42; },
      caf: (id) => { cancelledId = id; scheduledCallback = null; },
    });

    loop.start();
    expect(scheduledCallback).not.toBeNull();
    loop.stop();
    expect(cancelledId).toBe(42);
    expect(scheduledCallback).toBeNull();
  });
});
