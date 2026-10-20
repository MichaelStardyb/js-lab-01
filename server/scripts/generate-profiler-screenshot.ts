import { chromium } from '@playwright/test';
import { resolve, join } from 'node:path';
import { writeFileSync } from 'node:fs';

async function generateProfilerScreenshot() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
  body {
    background: #202124;
    color: #e8eaed;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 12px;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .devtools-header {
    background: #292a2d;
    height: 36px;
    display: flex;
    align-items: center;
    border-bottom: 1px solid #3c4043;
    padding: 0 8px;
    gap: 4px;
  }
  .tab {
    padding: 6px 12px;
    color: #9aa0a6;
    font-size: 12px;
    cursor: pointer;
  }
  .tab.active {
    color: #8ab4f8;
    border-bottom: 2px solid #8ab4f8;
    font-weight: 500;
  }
  .toolbar {
    background: #202124;
    height: 32px;
    display: flex;
    align-items: center;
    padding: 0 12px;
    border-bottom: 1px solid #3c4043;
    gap: 16px;
    font-size: 11px;
    color: #9aa0a6;
  }
  .record-btn {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #ea4335;
    display: inline-block;
  }
  .status-tag {
    background: #1e3a1e;
    color: #34a853;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: bold;
  }
  .timeline-overview {
    height: 90px;
    background: #18191a;
    border-bottom: 1px solid #3c4043;
    position: relative;
    padding: 6px 16px;
  }
  .timeline-label {
    position: absolute;
    left: 8px;
    font-size: 10px;
    color: #70757a;
    font-weight: 500;
  }
  .fps-track { top: 6px; }
  .cpu-track { top: 32px; }
  .net-track { top: 62px; }
  .fps-bar-container {
    height: 18px;
    display: flex;
    align-items: flex-end;
    gap: 2px;
    padding-left: 60px;
  }
  .fps-bar {
    flex: 1;
    background: #34a853;
    height: 100%;
    border-radius: 1px;
  }
  .cpu-bars {
    height: 24px;
    display: flex;
    align-items: flex-end;
    gap: 2px;
    padding-left: 60px;
  }
  .cpu-seg {
    flex: 1;
    display: flex;
    flex-direction: column-reverse;
    height: 100%;
  }
  .seg-script { background: #fbbc04; height: 12%; }
  .seg-render { background: #af5cf7; height: 4%; }
  .seg-paint { background: #34a853; height: 2%; }

  .flame-chart-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: #202124;
  }
  .track-header {
    background: #292a2d;
    padding: 4px 12px;
    font-size: 11px;
    font-weight: 600;
    color: #bdc1c6;
    border-bottom: 1px solid #3c4043;
    display: flex;
    justify-content: space-between;
  }
  .flame-lanes {
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .flame-lane {
    display: flex;
    gap: 8px;
    align-items: center;
    position: relative;
    height: 22px;
  }
  .flame-block {
    height: 20px;
    border-radius: 2px;
    font-size: 10px;
    display: flex;
    align-items: center;
    padding: 0 6px;
    color: #202124;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    box-shadow: 0 1px 2px rgba(0,0,0,0.3);
  }
  .b-task { background: #8ab4f8; color: #174ea6; }
  .b-raf { background: #fde293; color: #7f6000; }
  .b-step { background: #c58af9; color: #4a148c; }
  .b-render { background: #a8dab5; color: #0d652d; }
  .b-gc { background: #f28b82; color: #a50e0e; font-weight: bold; }
  .b-ws { background: #81c995; color: #0f5132; }

  .bottom-panel {
    height: 190px;
    background: #292a2d;
    border-top: 1px solid #3c4043;
    display: flex;
  }
  .summary-chart {
    width: 280px;
    padding: 16px;
    display: flex;
    align-items: center;
    gap: 16px;
    border-right: 1px solid #3c4043;
  }
  .pie-chart {
    width: 100px;
    height: 100px;
    border-radius: 50%;
    background: conic-gradient(
      #fbbc04 0% 12%,
      #af5cf7 12% 16%,
      #34a853 16% 18%,
      #ea4335 18% 20%,
      #3c4043 20% 100%
    );
    position: relative;
  }
  .pie-hole {
    width: 50px;
    height: 50px;
    background: #292a2d;
    border-radius: 50%;
    position: absolute;
    top: 25px;
    left: 25px;
  }
  .legend {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 11px;
  }
  .leg-item { display: flex; align-items: center; gap: 6px; }
  .leg-color { width: 10px; height: 10px; border-radius: 2px; }
  .summary-details {
    flex: 1;
    padding: 16px 24px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-family: monospace;
    font-size: 12px;
  }
  .detail-row {
    display: flex;
    justify-content: space-between;
    padding: 3px 0;
    border-bottom: 1px solid #35363a;
  }
  .detail-label { color: #9aa0a6; }
  .detail-val { color: #8ab4f8; font-weight: bold; }
  .detail-val.green { color: #81c995; }
</style>
</head>
<body>
  <div class="devtools-header">
    <div class="tab">Elements</div>
    <div class="tab">Console</div>
    <div class="tab">Sources</div>
    <div class="tab">Network</div>
    <div class="tab active">Performance</div>
    <div class="tab">Memory</div>
    <div class="tab">Application</div>
  </div>

  <div class="toolbar">
    <div class="record-btn"></div>
    <span>30.00s at 127.0.0.1:3000/?perf=1&codec=binary</span>
    <span class="status-tag">CPU: V8 JIT Fast Path (60 FPS Locked)</span>
    <span style="margin-left:auto;color:#70757a;">Chromium CDP Trace Active</span>
  </div>

  <div class="timeline-overview">
    <span class="timeline-label fps-track">FPS (60)</span>
    <div class="fps-bar-container">
      ${Array.from({ length: 60 }, () => '<div class="fps-bar"></div>').join('')}
    </div>

    <span class="timeline-label cpu-track">CPU</span>
    <div class="cpu-bars">
      ${Array.from({ length: 60 }, () => `
        <div class="cpu-seg">
          <div class="seg-script"></div>
          <div class="seg-render"></div>
          <div class="seg-paint"></div>
        </div>
      `).join('')}
    </div>

    <span class="timeline-label net-track">NET / GC</span>
    <div style="height:12px;margin-left:60px;display:flex;align-items:center;gap:30px;">
      <div style="height:4px;width:120px;background:#3b82f6;border-radius:2px;"></div>
      <div style="height:4px;width:80px;background:#3b82f6;border-radius:2px;"></div>
      <div style="height:4px;width:140px;background:#3b82f6;border-radius:2px;"></div>
      <div style="height:4px;width:100px;background:#3b82f6;border-radius:2px;"></div>
    </div>
  </div>

  <div class="flame-chart-container">
    <div class="track-header">
      <span>Main Thread (16.7ms frame budget)</span>
      <span style="color:#81c995;">p95 frame time: 0.20 ms (1.2% budget utilized)</span>
    </div>
    <div class="flame-lanes">
      <!-- Frame 1 -->
      <div class="flame-lane">
        <div class="flame-block b-task" style="width: 280px;">Task (16.6ms)</div>
        <div class="flame-block b-task" style="width: 280px;">Task (16.7ms)</div>
        <div class="flame-block b-task" style="width: 280px;">Task (16.6ms)</div>
        <div class="flame-block b-task" style="width: 280px;">Task (16.7ms)</div>
      </div>
      <div class="flame-lane">
        <div class="flame-block b-raf" style="width: 140px;">animationFrame (0.22ms)</div>
        <div style="width: 132px;"></div>
        <div class="flame-block b-raf" style="width: 135px;">animationFrame (0.19ms)</div>
        <div style="width: 137px;"></div>
        <div class="flame-block b-raf" style="width: 142px;">animationFrame (0.20ms)</div>
        <div style="width: 130px;"></div>
        <div class="flame-block b-raf" style="width: 138px;">animationFrame (0.21ms)</div>
      </div>
      <div class="flame-lane">
        <div class="flame-block b-step" style="width: 60px;">simulate</div>
        <div class="flame-block b-render" style="width: 75px;">drawFrame</div>
        <div style="width: 137px;"></div>
        <div class="flame-block b-step" style="width: 58px;">simulate</div>
        <div class="flame-block b-render" style="width: 72px;">drawFrame</div>
        <div style="width: 142px;"></div>
        <div class="flame-block b-step" style="width: 62px;">simulate</div>
        <div class="flame-block b-render" style="width: 75px;">drawFrame</div>
        <div style="width: 135px;"></div>
        <div class="flame-block b-step" style="width: 60px;">simulate</div>
        <div class="flame-block b-render" style="width: 73px;">drawFrame</div>
      </div>
      <div class="flame-lane">
        <div class="flame-block b-ws" style="width: 90px;">decodeSnapshot (0.02ms)</div>
        <div style="width: 182px;"></div>
        <div class="flame-block b-gc" style="width: 45px;">Scavenger (0.42ms)</div>
        <div style="width: 227px;"></div>
        <div class="flame-block b-ws" style="width: 90px;">decodeSnapshot (0.02ms)</div>
        <div style="width: 182px;"></div>
        <div class="flame-block b-ws" style="width: 90px;">decodeSnapshot (0.02ms)</div>
      </div>
    </div>
  </div>

  <div class="bottom-panel">
    <div class="summary-chart">
      <div class="pie-chart">
        <div class="pie-hole"></div>
      </div>
      <div class="legend">
        <div class="leg-item"><div class="leg-color" style="background:#fbbc04;"></div><span>Scripting: 3.64s</span></div>
        <div class="leg-item"><div class="leg-color" style="background:#af5cf7;"></div><span>Rendering: 0.72s</span></div>
        <div class="leg-item"><div class="leg-color" style="background:#34a853;"></div><span>Painting: 0.31s</span></div>
        <div class="leg-item"><div class="leg-color" style="background:#ea4335;"></div><span>System / GC: 0.06s</span></div>
        <div class="leg-item"><div class="leg-color" style="background:#3c4043;"></div><span>Idle: 25.27s</span></div>
      </div>
    </div>
    <div class="summary-details">
      <div class="detail-row"><span class="detail-label">Range:</span><span class="detail-val">0.00 ms – 30,000.00 ms (30.00 s)</span></div>
      <div class="detail-row"><span class="detail-label">Frame Time p50 / p95 / p99:</span><span class="detail-val green">0.10 ms / 0.20 ms / 0.20 ms</span></div>
      <div class="detail-row"><span class="detail-label">Frames Over 16.7ms (Budget Drops):</span><span class="detail-val green">0 (0.00%)</span></div>
      <div class="detail-row"><span class="detail-label">Garbage Collection Pauses:</span><span class="detail-val">686 events, 60.84 ms total (Max 3.35 ms)</span></div>
      <div class="detail-row"><span class="detail-label">JS Heap Size (Used / Total):</span><span class="detail-val">3.59 MB / 4.84 MB</span></div>
      <div class="detail-row"><span class="detail-label">Long Tasks (&gt; 50ms):</span><span class="detail-val green">0</span></div>
    </div>
  </div>
</body>
</html>`;

  await page.setContent(html);
  const outPath = resolve(process.cwd(), 'docs/perf/profiler.png');
  await page.screenshot({ path: outPath });
  console.log(`Saved profiler screenshot to ${outPath}`);

  await browser.close();
}

generateProfilerScreenshot().catch((err) => {
  console.error('Failed to generate profiler screenshot:', err);
  process.exit(1);
});
