export class LatencyInjector {
  constructor({ minLatency = 100, jitter = 15, dropRate = 0.02, random = Math.random } = {}) {
    if (!Number.isFinite(minLatency) || minLatency < 0 || minLatency > 2000) {
      throw new RangeError('minLatency must be between 0 and 2000 ms');
    }
    if (!Number.isFinite(jitter) || jitter < 0 || jitter > 1000) {
      throw new RangeError('jitter must be between 0 and 1000 ms');
    }
    if (!Number.isFinite(dropRate) || dropRate < 0 || dropRate > 1) {
      throw new RangeError('dropRate must be between 0 and 1');
    }
    this.minLatency = minLatency;
    this.jitter = jitter;
    this.dropRate = dropRate;
    this.random = random;
  }

  dispatch(callback, timers) {
    if (this.random() < this.dropRate) return false;
    const variance = (this.random() * 2 - 1) * this.jitter;
    const timer = setTimeout(() => {
      timers?.delete(timer);
      callback();
    }, Math.max(0, this.minLatency + variance));
    timers?.add(timer);
    timer.unref?.();
    return true;
  }
}

export function parseNetworkSettings(searchParams) {
  const codec = searchParams.get('codec') ?? 'json';
  if (codec !== 'json' && codec !== 'binary') throw new RangeError('codec must be json or binary');
  const latencyText = searchParams.get('delay') ?? searchParams.get('latency');
  const jitterText = searchParams.get('jitter');
  const dropText = searchParams.get('drop');
  const minLatency = latencyText === null ? 100 : Number(latencyText);
  const jitter = jitterText === null ? 15 : Number(jitterText);
  const dropRate = dropText === null ? 0.02 : Number(dropText);
  if (![...searchParams.keys()].every((key) => ['codec', 'delay', 'latency', 'jitter', 'drop'].includes(key))) {
    throw new RangeError('Unsupported WebSocket configuration parameter');
  }
  return { codec, injector: new LatencyInjector({ minLatency, jitter, dropRate }) };
}
