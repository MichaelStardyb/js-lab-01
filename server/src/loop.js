const TICK_RATE = 30;
const STEP_MS = 1000 / TICK_RATE;

export function createFixedTicker({ stepMs = STEP_MS, tick, now = () => performance.now(), schedule = setTimeout, cancel = clearTimeout }) {
  if (!(stepMs > 0) || typeof tick !== 'function') throw new TypeError('stepMs and tick are required');
  let timer;
  let running = false;
  let nextTick = 0;

  function run() {
    if (!running) return;
    tick(stepMs / 1000);
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
  };
}

export { STEP_MS, TICK_RATE };
