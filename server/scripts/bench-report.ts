import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

interface BenchMetrics {
  label: string;
  timestamp: string;
  durationSeconds: number;
  client: {
    frameCount: number;
    p50FrameMs: number;
    p95FrameMs: number;
    p99FrameMs: number;
    maxFrameMs: number;
    avgFrameMs: number;
    framesOver16ms: number;
    longTaskCount: number;
    jsHeapUsedSize: number;
    gc: {
      minorCount: number;
      minorTotalMs: number;
      minorMaxMs: number;
      majorCount: number;
      majorTotalMs: number;
      majorMaxMs: number;
      longGcPauses: number;
    };
    top10Allocators: Array<{ name: string; location: string; bytes: number; kb: number }>;
  };
  server: {
    simulation?: {
      p50Ms: number;
      p95Ms: number;
      p99Ms: number;
      maxMs: number;
      overBudgetCount: number;
      totalTicks: number;
    };
    memory?: {
      rss: number;
      heapUsed: number;
    };
  };
}

function formatDelta(before: number, after: number, unit = 'мс', lowerIsBetter = true): string {
  const diff = after - before;
  const pct = before !== 0 ? (diff / before) * 100 : 0;
  const sign = diff > 0 ? '+' : '';
  const improved = lowerIsBetter ? diff <= 0 : diff >= 0;
  const badge = improved ? '🟢' : '🔴';
  return `${before.toFixed(2)}${unit} → **${after.toFixed(2)}${unit}** (${sign}${diff.toFixed(2)}${unit}, ${sign}${pct.toFixed(1)}%) ${badge}`;
}

export function generateReport(beforePath: string, afterPath: string): string {
  if (!existsSync(beforePath)) {
    throw new Error(`File not found: ${beforePath}`);
  }
  if (!existsSync(afterPath)) {
    throw new Error(`File not found: ${afterPath}`);
  }

  const before = JSON.parse(readFileSync(beforePath, 'utf8')) as BenchMetrics;
  const after = JSON.parse(readFileSync(afterPath, 'utf8')) as BenchMetrics;

  const bC = before.client;
  const aC = after.client;
  const bS = before.server?.simulation ?? { p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0, overBudgetCount: 0 };
  const aS = after.server?.simulation ?? { p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0, overBudgetCount: 0 };

  const md = `### Порівняльна таблиця продуктивності (Baseline vs After Optimization)

| Метрика | До оптимізації (\`${before.label}\`) | Після оптимізації (\`${after.label}\`) | Дельта (зміна) |
| :--- | :---: | :---: | :---: |
| **Час кадру p50** | ${bC.p50FrameMs.toFixed(2)} мс | ${aC.p50FrameMs.toFixed(2)} мс | ${formatDelta(bC.p50FrameMs, aC.p50FrameMs)} |
| **Час кадру p95** | ${bC.p95FrameMs.toFixed(2)} мс | ${aC.p95FrameMs.toFixed(2)} мс | ${formatDelta(bC.p95FrameMs, aC.p95FrameMs)} |
| **Час кадру p99** | ${bC.p99FrameMs.toFixed(2)} мс | ${aC.p99FrameMs.toFixed(2)} мс | ${formatDelta(bC.p99FrameMs, aC.p99FrameMs)} |
| **Час кадру Max** | ${bC.maxFrameMs.toFixed(2)} мс | ${aC.maxFrameMs.toFixed(2)} мс | ${formatDelta(bC.maxFrameMs, aC.maxFrameMs)} |
| **Кадрів > 16.7 мс** | ${bC.framesOver16ms} | ${aC.framesOver16ms} | ${formatDelta(bC.framesOver16ms, aC.framesOver16ms, '')} |
| **Довгі GC-паузи (> 5 мс)** | ${bC.gc.longGcPauses} | ${aC.gc.longGcPauses} | ${formatDelta(bC.gc.longGcPauses, aC.gc.longGcPauses, '')} |
| **Сумарний час GC** | ${(bC.gc.minorTotalMs + bC.gc.majorTotalMs).toFixed(2)} мс | ${(aC.gc.minorTotalMs + aC.gc.majorTotalMs).toFixed(2)} мс | ${formatDelta(bC.gc.minorTotalMs + bC.gc.majorTotalMs, aC.gc.minorTotalMs + aC.gc.majorTotalMs)} |
| **Макс. пауза GC** | ${Math.max(bC.gc.minorMaxMs, bC.gc.majorMaxMs).toFixed(2)} мс | ${Math.max(aC.gc.minorMaxMs, aC.gc.majorMaxMs).toFixed(2)} мс | ${formatDelta(Math.max(bC.gc.minorMaxMs, bC.gc.majorMaxMs), Math.max(aC.gc.minorMaxMs, aC.gc.majorMaxMs))} |
| **Long Tasks (блокування потоку)** | ${bC.longTaskCount} | ${aC.longTaskCount} | ${formatDelta(bC.longTaskCount, aC.longTaskCount, '')} |
| **JS Heap Used (Browser)** | ${(bC.jsHeapUsedSize / (1024 * 1024)).toFixed(2)} МБ | ${(aC.jsHeapUsedSize / (1024 * 1024)).toFixed(2)} МБ | ${formatDelta(bC.jsHeapUsedSize / (1024 * 1024), aC.jsHeapUsedSize / (1024 * 1024), ' МБ')} |
| **Серверний крок p50** | ${bS.p50Ms.toFixed(2)} мс | ${aS.p50Ms.toFixed(2)} мс | ${formatDelta(bS.p50Ms, aS.p50Ms)} |
| **Серверний крок p99** | ${bS.p99Ms.toFixed(2)} мс | ${aS.p99Ms.toFixed(2)} мс | ${formatDelta(bS.p99Ms, aS.p99Ms)} |
`;

  return md;
}

if (process.argv[1]?.includes('bench-report')) {
  const perfDir = resolve(process.cwd(), 'docs/perf');
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const beforeLabel = args[0] || 'before';
  const afterLabel = args[1] || 'after';
  const beforePath = join(perfDir, `${beforeLabel}.json`);
  const afterPath = join(perfDir, `${afterLabel}.json`);

  try {
    const report = generateReport(beforePath, afterPath);
    console.log('\n' + report);
    const outName = args.length >= 2 ? `report-${beforeLabel}-vs-${afterLabel}.md` : 'report.md';
    writeFileSync(join(perfDir, outName), report, 'utf8');
    console.log(`Saved report to docs/perf/${outName}`);
  } catch (err: unknown) {
    console.error('Failed to generate report:', err instanceof Error ? err.message : String(err));
  }
}
