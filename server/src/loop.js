const TICK_RATE = 30;
const STEP_MS = 1000 / TICK_RATE;

export function createFixedTicker({ stepMs = STEP_MS, tick, now = () => performance.now(), schedule = setTimeout, cancel = clearTimeout }) {
  if (!(stepMs > 0) || typeof tick !== 'function') throw new TypeError('stepMs and tick are required');
  let timer;
  let running = false;
  let nextTick = 0;
  let tickCount = 0;
  let lastDurationMs = 0;
  let totalDurationMs = 0;
  let maxDurationMs = 0;
  let lastJitterMs = 0;
  let totalJitterMs = 0;
  let maxJitterMs = 0;

  function run() {
    if (!running) return;
    const wakeTime = now();
    const jitter = Math.abs(wakeTime - nextTick);
    lastJitterMs = jitter;
    totalJitterMs += jitter;
    if (jitter > maxJitterMs) maxJitterMs = jitter;

    const tickStart = now();
    tick(stepMs / 1000);
    const duration = now() - tickStart;
    lastDurationMs = duration;
    totalDurationMs += duration;
    if (duration > maxDurationMs) maxDurationMs = duration;
    tickCount += 1;

    nextTick += stepMs;
    const completedAt = now();
    if (completedAt - nextTick > stepMs * 2) nextTick = completedAt + stepMs;
    timer = schedule(run, Math.max(0, nextTick - now()));
    timer?.unref?.();
  }

  return {
    start() {
      if (running) return;
      running = true;
      nextTick = now() + stepMs;
      timer = schedule(run, Math.max(0, nextTick - now()));
      timer?.unref?.();
    },
    stop() {
      running = false;
      if (timer !== undefined) cancel(timer);
    },
    getStats() {
      return {
        ticks: tickCount,
        stepMs,
        durationMs: {
          last: Number(lastDurationMs.toFixed(3)),
          avg: tickCount > 0 ? Number((totalDurationMs / tickCount).toFixed(3)) : 0,
          max: Number(maxDurationMs.toFixed(3)),
        },
        jitterMs: {
          last: Number(lastJitterMs.toFixed(3)),
          avg: tickCount > 0 ? Number((totalJitterMs / tickCount).toFixed(3)) : 0,
          max: Number(maxJitterMs.toFixed(3)),
        },
      };
    },
  };
}

export { STEP_MS, TICK_RATE };
