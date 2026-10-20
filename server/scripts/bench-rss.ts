import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Readable, Writable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { loadConfig } from '../src/config.js';
import { NdjsonTransform } from '../src/log/matchlog.js';

const targetBytes = 200 * 1024 * 1024;
const config = loadConfig();
const benchmarkPath = resolve(config.logDir, 'rss-benchmark.ndjson');
const payload = 'x'.repeat(64 * 1024);
const recordBytes = Buffer.byteLength(JSON.stringify({ type: 'benchmark', payload }) + '\n');
async function run() {
  await mkdir(dirname(benchmarkPath), { recursive: true });
  let generated = 0;
  async function* records() {
    while (generated < targetBytes) {
      generated += recordBytes;
      yield { type: 'benchmark', payload };
    }
  }

  const started = Date.now();
  let peakRss = process.memoryUsage().rss;
  let report = setInterval(() => {
    const currentRss = process.memoryUsage().rss;
    peakRss = Math.max(peakRss, currentRss);
    const rss = currentRss / 1024 / 1024;
    console.log(`${((Date.now() - started) / 1000).toFixed(0)}s RSS ${rss.toFixed(1)} MiB`);
  }, 1000);
  report.unref?.();

  try {
    await pipeline(
      Readable.from(records(), { objectMode: true }),
      new NdjsonTransform(),
      createWriteStream(benchmarkPath),
    );
    const file = await stat(benchmarkPath);
    console.log(`Generated ${(file.size / 1024 / 1024).toFixed(1)} MiB NDJSON; slow streamed read follows`);

    const slowReader = new Transform({
      transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: unknown) => void) {
        setTimeout(() => callback(null, chunk), 2);
      },
    });
    let consumed = 0;
    await pipeline(
      createReadStream(benchmarkPath, { highWaterMark: 64 * 1024 }),
      slowReader,
      new Writable({
        write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
          consumed += chunk.length;
          callback();
        },
      }),
    );
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
    console.log(`Streamed ${(consumed / 1024 / 1024).toFixed(1)} MiB; sampled peak RSS ${(peakRss / 1024 / 1024).toFixed(1)} MiB`);
  } finally {
    clearInterval(report);
    await unlink(benchmarkPath).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error('RSS benchmark failed:', error);
    process.exitCode = 1;
  });
}
