const TICK_RATE = 30;
const STEP_MS = 1000 / TICK_RATE;

export type TickerStats = {
  ticks: number;
  stepMs: number;
  durationMs: { last: number; avg: number; max: number };
  jitterMs: { last: number; avg: number; max: number };
};

function hasUnref(target: unknown): target is { unref: () => void } {
  return typeof target === 'object' && target !== null && 'unref' in target && typeof target.unref === 'function';
}

export type FixedTicker = {
  start(): void;
  stop(): void;
  getStats(): TickerStats;
};

function isTimeout(t: unknown): t is NodeJS.Timeout {
  return typeof t === 'object' && t !== null && 'hasRef' in t;
}

export function createFixedTicker({
  stepMs = STEP_MS,
  tick,
  now = () => performance.now(),
  schedule = (callback: () => void, delay: number) => setTimeout(callback, delay),
  cancel = (timer: unknown) => {
    if (typeof timer === 'number' || typeof timer === 'string') clearTimeout(timer);
    else if (isTimeout(timer)) clearTimeout(timer);
  },
}: {
  stepMs?: number;
  tick: (dt: number) => void;
  now?: () => number;
  schedule?: (callback: () => void, delay: number) => unknown;
  cancel?: (timer: unknown) => void;
}): FixedTicker {
  if (!(stepMs > 0) || typeof tick !== 'function') throw new TypeError('stepMs and tick are required');
  let timer: unknown;
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
    if (hasUnref(timer)) timer.unref();
  }

  return {
    start() {
      if (running) return;
      running = true;
      nextTick = now() + stepMs;
      timer = schedule(run, Math.max(0, nextTick - now()));
      if (hasUnref(timer)) timer.unref();
    },
    stop() {
      running = false;
      if (timer !== undefined) cancel(timer);
    },
    getStats(): TickerStats {
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
