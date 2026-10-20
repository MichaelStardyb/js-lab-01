import { resolve, join } from 'node:path';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createGameServer } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { startBots } from './run-bots.js';

interface LevelResult {
  clients: number;
  stepP50Ms: number;
  stepP95Ms: number;
  stepP99Ms: number;
  stepMaxMs: number;
  eventLoopDelayP50Ms: number;
  eventLoopDelayP99Ms: number;
  rssMb: number;
  bytesOutPerSec: number;
  overBudget: boolean;
}

function generateSvgChart(results: LevelResult[]): string {
  const width = 720;
  const height = 400;
  const padding = { top: 50, right: 40, bottom: 60, left: 70 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const maxVal = Math.max(36, ...results.map((r) => r.stepMaxMs), ...results.map((r) => r.stepP99Ms)) * 1.1;
  const budget = 33.33;

  const xScale = (idx: number) => padding.left + (idx / (results.length - 1)) * chartW;
  const yScale = (val: number) => padding.top + chartH - (Math.min(val, maxVal) / maxVal) * chartH;

  const budgetY = yScale(budget);

  // Line paths
  const p50Points = results.map((r, i) => `${xScale(i)},${yScale(r.stepP50Ms)}`).join(' ');
  const p95Points = results.map((r, i) => `${xScale(i)},${yScale(r.stepP95Ms)}`).join(' ');
  const p99Points = results.map((r, i) => `${xScale(i)},${yScale(r.stepP99Ms)}`).join(' ');

  const gridLines = [0, 10, 20, 30, 33.33].filter((v) => v <= maxVal).map((val) => {
    const y = yScale(val);
    return `
      <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#333" stroke-width="1" stroke-dasharray="3,3" />
      <text x="${padding.left - 10}" y="${y + 4}" fill="#888" font-size="11" text-anchor="end" font-family="monospace">${val.toFixed(1)}ms</text>
    `;
  }).join('');

  const xLabels = results.map((r, i) => {
    const x = xScale(i);
    return `
      <line x1="${x}" y1="${padding.top + chartH}" x2="${x}" y2="${padding.top + chartH + 6}" stroke="#666" stroke-width="1" />
      <text x="${x}" y="${padding.top + chartH + 22}" fill="#ccc" font-size="12" text-anchor="middle" font-family="sans-serif">${r.clients} клієнтів</text>
    `;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="background:#18181b;border-radius:8px;">
  <!-- Title -->
  <text x="${width / 2}" y="28" fill="#fff" font-size="16" font-weight="bold" text-anchor="middle" font-family="sans-serif">Серверний бенчмарк навантаження: Час кроку vs Кількість клієнтів</text>

  <!-- Grid & Axes -->
  ${gridLines}
  ${xLabels}
  <line x1="${padding.left}" y1="${padding.top + chartH}" x2="${width - padding.right}" y2="${padding.top + chartH}" stroke="#666" stroke-width="1.5" />
  <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + chartH}" stroke="#666" stroke-width="1.5" />

  <!-- 33.33ms Step Budget Line -->
  <line x1="${padding.left}" y1="${budgetY}" x2="${width - padding.right}" y2="${budgetY}" stroke="#ef4444" stroke-width="2" stroke-dasharray="6,4" />
  <text x="${width - padding.right}" y="${budgetY - 6}" fill="#ef4444" font-size="11" font-weight="bold" text-anchor="end" font-family="monospace">Бюджет кроку 30 Гц (33.3 мс)</text>

  <!-- Data Polylines -->
  <polyline points="${p50Points}" fill="none" stroke="#22c55e" stroke-width="2.5" />
  <polyline points="${p95Points}" fill="none" stroke="#eab308" stroke-width="2.5" />
  <polyline points="${p99Points}" fill="none" stroke="#3b82f6" stroke-width="2.5" />

  <!-- Data Points -->
  ${results.map((r, i) => `
    <circle cx="${xScale(i)}" cy="${yScale(r.stepP50Ms)}" r="4" fill="#22c55e" />
    <circle cx="${xScale(i)}" cy="${yScale(r.stepP95Ms)}" r="4" fill="#eab308" />
    <circle cx="${xScale(i)}" cy="${yScale(r.stepP99Ms)}" r="4" fill="#3b82f6" />
    <text x="${xScale(i)}" y="${yScale(r.stepP99Ms) - 10}" fill="#93c5fd" font-size="10" font-family="monospace" text-anchor="middle">${r.stepP99Ms.toFixed(2)}ms</text>
  `).join('')}

  <!-- Legend -->
  <g transform="translate(${padding.left + 20}, 45)">
    <circle cx="0" cy="0" r="4" fill="#22c55e" />
    <text x="10" y="4" fill="#22c55e" font-size="11" font-family="sans-serif">p50</text>
    <circle cx="50" cy="0" r="4" fill="#eab308" />
    <text x="60" y="4" fill="#eab308" font-size="11" font-family="sans-serif">p95</text>
    <circle cx="100" cy="0" r="4" fill="#3b82f6" />
    <text x="110" y="4" fill="#3b82f6" font-size="11" font-family="sans-serif">p99</text>
  </g>
</svg>`;
}

export async function runLoadBenchmark(durationPerLevelSeconds = 12) {
  console.log(`\n=== Running Server Load Benchmark (${durationPerLevelSeconds}s per level) ===`);

  const clientLevels = [8, 32, 64, 128];
  const port = 3400 + Math.floor(Math.random() * 300);
  const host = '127.0.0.1';
  const perfDir = resolve(process.cwd(), 'docs/perf');
  if (!existsSync(perfDir)) mkdirSync(perfDir, { recursive: true });

  const logDir = resolve(process.cwd(), 'logs/bench-load');
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });

  const config = loadConfig({
    PORT: String(port),
    HOST: host,
    LOG_DIR: logDir,
    ENABLE_METRICS: '1',
    MAX_PLAYERS_PER_ROOM: '256',
  });

  const staticDir = resolve(process.cwd(), 'client/dist');
  const serverRuntime = createGameServer({ config, staticDir });
  await serverRuntime.listen(port, host);
  console.log(`Server listening on http://${host}:${port}`);

  const results: LevelResult[] = [];

  for (const clientCount of clientLevels) {
    const room = `load-${clientCount}-${Date.now()}`;
    console.log(`\n--- Testing ${clientCount} clients in room "${room}" ---`);

    const bots = await startBots({
      count: clientCount,
      room,
      url: `ws://${host}:${port}/ws?codec=binary`,
    });

    console.log(`Warming up ${clientCount} bots for 3 seconds...`);
    await new Promise((r) => setTimeout(r, 3000));

    // Reset metrics before measurement
    const resetRes = await fetch(`http://${host}:${port}/metrics`, { method: 'POST' }).catch(() => null);
    if (!resetRes || !resetRes.ok) {
      // Just continue
    }

    console.log(`Measuring for ${durationPerLevelSeconds} seconds...`);
    await new Promise((r) => setTimeout(r, durationPerLevelSeconds * 1000));

    const metricsRes = await fetch(`http://${host}:${port}/metrics`);
    const metricsData = (await metricsRes.json()) as Record<string, Record<string, unknown>>;

    const sim = metricsData['simulation'] ?? {};
    const ev = metricsData['eventLoop'] ?? {};
    const mem = metricsData['memory'] ?? {};
    const net = metricsData['network'] ?? {};

    const p50 = Number(sim['p50Ms'] ?? 0);
    const p95 = Number(sim['p95Ms'] ?? 0);
    const p99 = Number(sim['p99Ms'] ?? 0);
    const max = Number(sim['maxMs'] ?? 0);
    const loopP50 = Number(ev['p50Ms'] ?? 0);
    const loopP99 = Number(ev['p99Ms'] ?? 0);
    const rssMb = Number(mem['rss'] ?? 0) / (1024 * 1024);
    const bytesOutPerSec = Number(net['bytesOutPerSec'] ?? 0);
    const overBudget = p99 > 33.33;

    results.push({
      clients: clientCount,
      stepP50Ms: p50,
      stepP95Ms: p95,
      stepP99Ms: p99,
      stepMaxMs: max,
      eventLoopDelayP50Ms: loopP50,
      eventLoopDelayP99Ms: loopP99,
      rssMb,
      bytesOutPerSec,
      overBudget,
    });

    console.log(`Result for ${clientCount} clients: p50=${p50.toFixed(3)}ms, p99=${p99.toFixed(3)}ms, max=${max.toFixed(3)}ms, RSS=${rssMb.toFixed(1)}MB, Net=${(bytesOutPerSec / 1024).toFixed(1)}KB/s, OverBudget=${overBudget}`);

    bots.stop();
    await new Promise((r) => setTimeout(r, 1000));
  }

  serverRuntime.server.close();

  // Save JSON
  const jsonPath = join(perfDir, 'load.json');
  writeFileSync(jsonPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`Saved load metrics to ${jsonPath}`);

  // Save SVG
  const svg = generateSvgChart(results);
  const svgPath = join(perfDir, 'load.svg');
  writeFileSync(svgPath, svg, 'utf8');
  console.log(`Saved load SVG chart to ${svgPath}`);

  // Save Markdown
  const degradation = results.find((r) => r.overBudget);
  const conclusionText = degradation
    ? `**Поріг деградації**: Сервер перевищує бюджет кроку (33.3 мс) при **N = ${degradation.clients}** клієнтів (p99 = ${degradation.stepP99Ms.toFixed(2)} мс).`
    : `**Поріг деградації**: Навіть при **N = 128** одночасних клієнтах сервер **НЕ перевищує бюджет кроку** 33.3 мс (p99 = ${results[results.length - 1]?.stepP99Ms.toFixed(2)} мс < 33.3 мс). Запас продуктивності становить ${(33.33 / (results[results.length - 1]?.stepP99Ms || 1)).toFixed(1)}x.`;

  const md = `# Результати серверного бенчмарку навантаження

- **Частота симуляції**: 30 Гц (бюджет кроку: **33.33 мс**)
- **Вхідний потік**: кожен клієнт надсилає бінарні пакети з частотою 60 Гц
- **Вихідний потік**: бінарні снепшоти зі зрізом послідовностей (pre-encoded buffer)

## Таблиця навантаження (8, 32, 64, 128 клієнтів)

| Клієнтів (N) | Крок p50 (мс) | Крок p95 (мс) | Крок p99 (мс) | Крок Max (мс) | Event Loop p99 (мс) | RSS (МБ) | Вихідний трафік (КБ/с) | Статус бюджету (<33.3мс) |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
${results.map((r) => `| **${r.clients}** | ${r.stepP50Ms.toFixed(3)} | ${r.stepP95Ms.toFixed(3)} | ${r.stepP99Ms.toFixed(3)} | ${r.stepMaxMs.toFixed(3)} | ${r.eventLoopDelayP99Ms.toFixed(2)} | ${r.rssMb.toFixed(1)} | ${(r.bytesOutPerSec / 1024).toFixed(1)} | ${r.overBudget ? '🔴 ПЕРЕВИЩЕНО' : '🟢 В НОРМІ'} |`).join('\n')}

## Висновок
${conclusionText}
`;

  const mdPath = join(perfDir, 'load.md');
  writeFileSync(mdPath, md, 'utf8');
  console.log(`Saved load report to ${mdPath}`);

  return results;
}

if (process.argv[1]?.includes('bench-load')) {
  runLoadBenchmark().catch((err) => {
    console.error('Load benchmark failed:', err);
    process.exit(1);
  });
}
