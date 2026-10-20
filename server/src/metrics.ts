import { monitorEventLoopDelay, PerformanceObserver, performance } from 'node:perf_hooks';
import type { RoomManager } from './rooms.js';

interface GcStats {
  minorCount: number;
  minorDurationMs: number;
  majorCount: number;
  majorDurationMs: number;
  totalCount: number;
  totalDurationMs: number;
}

export class MetricsCollector {
  #enabled: boolean;
  #tickDurations: number[] = [];
  #stepLags: number[] = [];
  #overBudgetCount = 0;
  #totalTicks = 0;

  #bytesOutWindow = 0;
  #totalBytesOut = 0;
  #lastBytesRateCheck = performance.now();
  #bytesOutPerSec = 0;

  #eventLoopMonitor: ReturnType<typeof monitorEventLoopDelay> | null = null;
  #gcStats: GcStats = {
    minorCount: 0,
    minorDurationMs: 0,
    majorCount: 0,
    majorDurationMs: 0,
    totalCount: 0,
    totalDurationMs: 0,
  };
  #gcObserver: PerformanceObserver | null = null;

  constructor(enabled: boolean) {
    this.#enabled = enabled;
    if (this.#enabled) {
      try {
        this.#eventLoopMonitor = monitorEventLoopDelay({ resolution: 20 });
        this.#eventLoopMonitor.enable();
      } catch {
        this.#eventLoopMonitor = null;
      }

      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const dur = entry.duration;
            this.#gcStats.totalCount++;
            this.#gcStats.totalDurationMs += dur;
            const name = entry.name.toLowerCase();
            if (name.includes('minor') || name.includes('scavenge')) {
              this.#gcStats.minorCount++;
              this.#gcStats.minorDurationMs += dur;
            } else {
              this.#gcStats.majorCount++;
              this.#gcStats.majorDurationMs += dur;
            }
          }
        });
        observer.observe({ entryTypes: ['gc'] });
        this.#gcObserver = observer;
      } catch {
        this.#gcObserver = null;
      }
    }
  }

  get isEnabled(): boolean {
    return this.#enabled;
  }

  recordTick(durationMs: number, lagMs: number): void {
    if (!this.#enabled) return;
    this.#totalTicks++;
    if (durationMs > 33.333) {
      this.#overBudgetCount++;
    }
    this.#tickDurations.push(durationMs);
    this.#stepLags.push(lagMs);

    // Keep ring buffer max 10,000 entries
    if (this.#tickDurations.length > 10000) {
      this.#tickDurations.shift();
      this.#stepLags.shift();
    }
  }

  recordBytesOut(bytes: number): void {
    if (!this.#enabled) return;
    this.#bytesOutWindow += bytes;
    this.#totalBytesOut += bytes;

    const now = performance.now();
    const elapsed = now - this.#lastBytesRateCheck;
    if (elapsed >= 1000) {
      this.#bytesOutPerSec = (this.#bytesOutWindow / elapsed) * 1000;
      this.#bytesOutWindow = 0;
      this.#lastBytesRateCheck = now;
    }
  }

  reset(): void {
    this.#tickDurations = [];
    this.#stepLags = [];
    this.#overBudgetCount = 0;
    this.#totalTicks = 0;
    this.#gcStats = {
      minorCount: 0,
      minorDurationMs: 0,
      majorCount: 0,
      majorDurationMs: 0,
      totalCount: 0,
      totalDurationMs: 0,
    };
    if (this.#eventLoopMonitor) {
      this.#eventLoopMonitor.reset();
    }
  }

  #calcPercentiles(arr: number[]): { p50: number; p95: number; p99: number; max: number; avg: number } {
    if (arr.length === 0) return { p50: 0, p95: 0, p99: 0, max: 0, avg: 0 };
    const sorted = [...arr].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.50)] ?? 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
    const max = sorted[sorted.length - 1] ?? 0;
    const sum = sorted.reduce((acc, v) => acc + v, 0);
    const avg = sum / sorted.length;
    return { p50, p95, p99, max, avg };
  }

  getSummary(roomManager?: RoomManager): Record<string, unknown> {
    const tickStats = this.#calcPercentiles(this.#tickDurations);
    const lagStats = this.#calcPercentiles(this.#stepLags);

    let elP50 = 0;
    let elP95 = 0;
    let elP99 = 0;
    let elMax = 0;

    if (this.#eventLoopMonitor) {
      elP50 = this.#eventLoopMonitor.percentile(50) / 1e6; // ns to ms
      elP95 = this.#eventLoopMonitor.percentile(95) / 1e6;
      elP99 = this.#eventLoopMonitor.percentile(99) / 1e6;
      elMax = this.#eventLoopMonitor.max / 1e6;
    }

    const mem = process.memoryUsage();

    let activeRooms = 0;
    let activeClients = 0;
    let activeEntities = 0;

    if (roomManager) {
      activeRooms = roomManager.rooms.size;
      for (const room of roomManager.rooms.values()) {
        activeClients += room.players.size;
        if (room.gameSession) {
          activeEntities += room.players.size; // baseline ships
        }
      }
    }

    return {
      simulation: {
        totalTicks: this.#totalTicks,
        overBudgetCount: this.#overBudgetCount,
        overBudgetRatio: this.#totalTicks > 0 ? this.#overBudgetCount / this.#totalTicks : 0,
        p50Ms: tickStats.p50,
        p95Ms: tickStats.p95,
        p99Ms: tickStats.p99,
        maxMs: tickStats.max,
        avgMs: tickStats.avg,
        stepLagP50Ms: lagStats.p50,
        stepLagP99Ms: lagStats.p99,
        stepLagMaxMs: lagStats.max,
      },
      eventLoop: {
        p50Ms: elP50,
        p95Ms: elP95,
        p99Ms: elP99,
        maxMs: elMax,
      },
      gc: { ...this.#gcStats },
      memory: {
        rss: mem.rss,
        heapTotal: mem.heapTotal,
        heapUsed: mem.heapUsed,
        external: mem.external,
      },
      network: {
        bytesOutPerSec: this.#bytesOutPerSec,
        totalBytesOut: this.#totalBytesOut,
      },
      world: {
        activeRooms,
        activeClients,
        activeEntities,
      },
    };
  }

  destroy(): void {
    if (this.#gcObserver) {
      this.#gcObserver.disconnect();
      this.#gcObserver = null;
    }
    if (this.#eventLoopMonitor) {
      this.#eventLoopMonitor.disable();
      this.#eventLoopMonitor = null;
    }
  }
}
