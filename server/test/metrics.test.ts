import { describe, it, expect } from 'vitest';
import { MetricsCollector } from '../src/metrics.js';

describe('server/metrics MetricsCollector', () => {
  it('does nothing when disabled', () => {
    const collector = new MetricsCollector(false);
    expect(collector.isEnabled).toBe(false);
    collector.recordTick(10, 2);
    collector.recordBytesOut(500);

    const summary = collector.getSummary() as Record<string, Record<string, number>>;
    expect(summary['simulation']?.['totalTicks']).toBe(0);
    collector.destroy();
  });

  it('records tick duration, lag, and calculates percentiles when enabled', () => {
    const collector = new MetricsCollector(true);
    expect(collector.isEnabled).toBe(true);

    collector.recordTick(5, 1);
    collector.recordTick(10, 2);
    collector.recordTick(15, 3);
    collector.recordTick(40, 5); // 1 over budget (> 33.3ms)

    const summary = collector.getSummary() as Record<string, Record<string, number>>;
    expect(summary['simulation']?.['totalTicks']).toBe(4);
    expect(summary['simulation']?.['overBudgetCount']).toBe(1);
    expect(summary['simulation']?.['maxMs']).toBe(40);
    expect(summary['simulation']?.['p50Ms']).toBe(15);

    collector.reset();
    const resetSummary = collector.getSummary() as Record<string, Record<string, number>>;
    expect(resetSummary['simulation']?.['totalTicks']).toBe(0);

    collector.destroy();
  });
});
