import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createGameServer } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { startBots } from './run-bots.js';

interface AllocationHotspot {
  functionName: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
  selfSize: number;
}

interface HeapProfileNode {
  callFrame: {
    functionName: string;
    scriptId: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
  };
  selfSize: number;
  children?: HeapProfileNode[];
}

function extractHotspots(node: HeapProfileNode, list: AllocationHotspot[] = []): AllocationHotspot[] {
  if (node.selfSize > 0) {
    list.push({
      functionName: node.callFrame.functionName || '(anonymous)',
      url: node.callFrame.url,
      lineNumber: node.callFrame.lineNumber,
      columnNumber: node.callFrame.columnNumber,
      selfSize: node.selfSize,
    });
  }
  if (node.children) {
    for (const child of node.children) {
      extractHotspots(child, list);
    }
  }
  return list;
}

export async function runBrowserBenchmark(label = 'before', durationSeconds = 30, extraQuery = ''): Promise<Record<string, unknown>> {
  console.log(`\n=== Running Browser Benchmark (label: "${label}", duration: ${durationSeconds}s, query: "${extraQuery}") ===`);

  const port = 3200 + Math.floor(Math.random() * 500);
  const host = '127.0.0.1';
  const room = `bench-${Date.now()}`;
  const perfDir = resolve(process.cwd(), 'docs/perf');
  if (!existsSync(perfDir)) mkdirSync(perfDir, { recursive: true });

  const logDir = resolve(process.cwd(), 'logs/bench');
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });

  // 1. Start server with metrics enabled
  const config = loadConfig({
    PORT: String(port),
    HOST: host,
    LOG_DIR: logDir,
    ENABLE_METRICS: '1',
    MAX_PLAYERS_PER_ROOM: '32',
  });

  const staticDir = resolve(process.cwd(), 'client/dist');
  const serverRuntime = createGameServer({ config, staticDir });
  await serverRuntime.listen(port, host);
  console.log(`Server listening at http://${host}:${port}`);

  // 2. Start 8 bots
  const bots = await startBots({
    count: 8,
    room,
    duration: durationSeconds + 15,
    url: `ws://${host}:${port}/ws`,
    codec: 'binary',
    onLog: () => {},
  });
  console.log(`8 bots connected to room "${room}"`);

  // 3. Launch Chromium with precise memory flags
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--js-flags=--expose-gc',
      '--enable-precise-memory-info',
      '--disable-gpu-vsync',
    ],
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const cdp = await page.context().newCDPSession(page);

  await cdp.send('Performance.enable');
  await cdp.send('HeapProfiler.enable');

  const traceEvents: Array<Record<string, unknown>> = [];
  cdp.on('Tracing.dataCollected', (event) => {
    traceEvents.push(...event.value);
  });

  // Navigate to client
  const fullUrl = `http://${host}:${port}/?perf=1&codec=binary&delay=0&jitter=0&drop=0${extraQuery ? `&${extraQuery}` : ''}`;
  await page.goto(fullUrl);

  // Join room in lobby
  await page.locator('input[name="nickname"]').fill('BenchPlayer');
  await page.locator('input[name="room"]').fill(room);
  await page.locator('#join-form button[type="submit"]').click();

  // Wait for connection and initialization
  await page.waitForFunction(() => {
    return (window as unknown as { __perf?: unknown }).__perf !== undefined;
  }, { timeout: 10000 });

  console.log('Warming up for 5 seconds...');
  await page.waitForTimeout(5000);

  // Reset performance counters before the 30-second measurement window
  await page.evaluate(() => {
    (window as unknown as { __perf: { reset: () => void } }).__perf.reset();
  });

  // Start CDP tracing & heap sampling
  console.log(`Starting ${durationSeconds}s measurement window with CDP tracing & sampling...`);
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 32768 });
  await cdp.send('Tracing.start', {
    categories: 'devtools.timeline,v8,v8.gc,disabled-by-default-v8.gc',
    options: 'sampling-frequency=10000',
  });

  // Simulate active player gameplay inputs for the measured window
  const startTime = Date.now();
  await page.locator('#gameCanvas').focus();

  let toggleThrust = false;
  while (Date.now() - startTime < durationSeconds * 1000) {
    toggleThrust = !toggleThrust;
    if (toggleThrust) {
      await page.keyboard.down('KeyW');
      await page.keyboard.down('KeyD');
    } else {
      await page.keyboard.up('KeyW');
      await page.keyboard.up('KeyD');
      await page.keyboard.press('Space');
    }
    await page.waitForTimeout(200);
  }
  await page.keyboard.up('KeyW');
  await page.keyboard.up('KeyD');

  // Stop sampling & tracing
  const samplingResult = await cdp.send('HeapProfiler.stopSampling') as { profile: { head: HeapProfileNode } };
  const profile = samplingResult.profile;

  await new Promise<void>((res) => {
    cdp.once('Tracing.tracingComplete', () => res());
    cdp.send('Tracing.end').catch(() => res());
  });

  // Collect client metrics
  const clientMetrics = await page.evaluate(() => {
    return (window as unknown as { __perf: { getMetrics: () => Record<string, number> } }).__perf.getMetrics();
  });

  // Collect server metrics
  const serverRes = await fetch(`http://${host}:${port}/metrics`);
  const serverMetrics = serverRes.ok ? await serverRes.json() as Record<string, unknown> : {};

  // Analyze GC events from trace
  let minorGcCount = 0;
  let minorGcTotalMs = 0;
  let minorGcMaxMs = 0;
  let majorGcCount = 0;
  let majorGcTotalMs = 0;
  let majorGcMaxMs = 0;
  let longGcPauses = 0; // GC pauses > 5ms

  for (const ev of traceEvents) {
    if (ev['ph'] === 'X' && typeof ev['dur'] === 'number') {
      const durMs = ev['dur'] / 1000;
      const rawName = typeof ev['name'] === 'string' ? ev['name'] : '';
      const name = rawName.toLowerCase();
      const isGc = name.includes('gc') || name.includes('scavenge') || name.includes('markcompact');
      if (isGc) {
        if (name.includes('minor') || name.includes('scavenge')) {
          minorGcCount++;
          minorGcTotalMs += durMs;
          if (durMs > minorGcMaxMs) minorGcMaxMs = durMs;
        } else {
          majorGcCount++;
          majorGcTotalMs += durMs;
          if (durMs > majorGcMaxMs) majorGcMaxMs = durMs;
        }
        if (durMs > 5.0) {
          longGcPauses++;
        }
      }
    }
  }

  // Analyze top allocation hotspots
  const allHotspots = extractHotspots(profile.head);
  allHotspots.sort((a, b) => b.selfSize - a.selfSize);
  const top10Allocators = allHotspots.slice(0, 10).map((h) => ({
    name: h.functionName,
    location: `${h.url.split('/').pop() || h.url}:${h.lineNumber}:${h.columnNumber}`,
    bytes: h.selfSize,
    kb: Math.round(h.selfSize / 1024),
  }));

  // Clean up
  await browser.close();
  await bots.stop();
  await serverRuntime.close();

  // Save trace file if not excessively huge
  const tracePath = join(perfDir, `trace-${label}.json`);
  if (traceEvents.length > 0) {
    const traceJson = JSON.stringify({ traceEvents });
    if (traceJson.length < 50 * 1024 * 1024) {
      writeFileSync(tracePath, traceJson, 'utf8');
      console.log(`Saved CDP trace to ${tracePath} (${Math.round(traceJson.length / 1024)} KB)`);
    }
  }

  const result = {
    label,
    timestamp: new Date().toISOString(),
    durationSeconds,
    client: {
      ...clientMetrics,
      gc: {
        minorCount: minorGcCount,
        minorTotalMs: Number(minorGcTotalMs.toFixed(2)),
        minorMaxMs: Number(minorGcMaxMs.toFixed(2)),
        majorCount: majorGcCount,
        majorTotalMs: Number(majorGcTotalMs.toFixed(2)),
        majorMaxMs: Number(majorGcMaxMs.toFixed(2)),
        longGcPauses, // pauses > 5ms
      },
      top10Allocators,
    },
    server: serverMetrics,
  };

  const jsonPath = join(perfDir, `${label}.json`);
  writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf8');
  console.log(`Saved benchmark metrics to ${jsonPath}`);

  // Markdown summary
  const mdContent = `# Результати вимірювання продуктивності: ${label}

- **Дата**: ${result.timestamp}
- **Тривалість тесту**: ${durationSeconds} с (після 5 с прогріву)
- **Боти**: 8 ботів у кімнаті \`${room}\`

## Клієнтські метрики (FPS та час кадру)
- **Кадрів всього**: ${clientMetrics['frameCount']}
- **Час кадру p50**: ${clientMetrics['p50FrameMs']?.toFixed(2)} мс
- **Час кадру p95**: ${clientMetrics['p95FrameMs']?.toFixed(2)} мс
- **Час кадру p99**: ${clientMetrics['p99FrameMs']?.toFixed(2)} мс
- **Час кадру Max**: ${clientMetrics['maxFrameMs']?.toFixed(2)} мс
- **Кадрів > 16.7 мс**: ${clientMetrics['framesOver16ms']}
- **Long Tasks**: ${clientMetrics['longTaskCount']}

## Garbage Collection (GC) у браузері
- **Minor GC (Scavenge)**: ${minorGcCount} подій (разом: ${minorGcTotalMs.toFixed(2)} мс, макс: ${minorGcMaxMs.toFixed(2)} мс)
- **Major GC (Mark-Sweep)**: ${majorGcCount} подій (разом: ${majorGcTotalMs.toFixed(2)} мс, макс: ${majorGcMaxMs.toFixed(2)} мс)
- **Довгі GC-паузи (> 5 мс)**: **${longGcPauses}**
- **JS Heap Used**: ${((clientMetrics['jsHeapUsedSize'] ?? 0) / (1024 * 1024)).toFixed(2)} MB

## Топ-10 джерел алокацій пам'яті (Heap Profiler)
| № | Функція | Локація | Обсяг (КБ) |
|---|---------|---------|------------|
${top10Allocators.map((a, idx) => `| ${idx + 1} | \`${a.name}\` | ${a.location} | ${a.kb} |`).join('\n')}
`;

  const mdPath = join(perfDir, `${label}.md`);
  writeFileSync(mdPath, mdContent, 'utf8');
  console.log(`Saved report summary to ${mdPath}`);

  return result;
}

// CLI runner
if (process.argv[1]?.includes('bench-browser')) {
  const args = process.argv.slice(2);
  const labelIdx = args.indexOf('--label');
  const nextArg = args[labelIdx + 1];
  const label = (labelIdx !== -1 && nextArg) ? nextArg : 'before';

  const runsIdx = args.indexOf('--runs');
  const nextRunsArg = args[runsIdx + 1];
  const runsCount = (runsIdx !== -1 && nextRunsArg) ? parseInt(nextRunsArg, 10) : 1;

  const queryIdx = args.indexOf('--query');
  const nextQueryArg = args[queryIdx + 1];
  const query = (queryIdx !== -1 && nextQueryArg) ? nextQueryArg : '';

  async function execute() {
    if (runsCount === 1) {
      await runBrowserBenchmark(label, 30, query);
    } else {
      console.log(`Running ${runsCount} runs for median calculation...`);
      for (let r = 1; r <= runsCount; r++) {
        await runBrowserBenchmark(`${label}-run${r}`, 30, query);
      }
      await runBrowserBenchmark(label, 30, query);
    }
  }

  execute().catch((err) => {
    console.error('Benchmark failed:', err);
    process.exit(1);
  });
}
