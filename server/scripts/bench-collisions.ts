import { performance } from 'node:perf_hooks';
import { SpatialHashGrid, type SpatialEntity } from 'shared/sim/spatialHash.js';

function naiveCheck(entities: SpatialEntity[]): number {
  let count = 0;
  const len = entities.length;
  for (let i = 0; i < len; i++) {
    const a = entities[i]!;
    for (let j = i + 1; j < len; j++) {
      const b = entities[j]!;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const distSq = dx * dx + dy * dy;
      const radSum = a.radius + b.radius;
      if (distSq < radSum * radSum) count++;
    }
  }
  return count;
}

function runComparison() {
  console.log('=== Порівняння: Naive O(N^2) vs SpatialHashGrid ===\n');
  const sizes = [16, 32, 64, 128, 256, 512];
  const grid = new SpatialHashGrid(800, 600, 64);
  const iterations = 500;

  console.log('| Сутностей (N) | Naive O(N^2) (мс/крок) | Spatial Hash (мс/крок) | Швидше | Прискорення |');
  console.log('| :---: | :---: | :---: | :---: | :---: |');

  for (const n of sizes) {
    const entities: SpatialEntity[] = Array.from({ length: n }, (_, id) => ({
      id,
      x: 50 + Math.random() * 700,
      y: 50 + Math.random() * 500,
      radius: 12 + Math.random() * 8,
    }));

    // Warm up
    for (let i = 0; i < 50; i++) {
      naiveCheck(entities);
      grid.findCollisions(entities);
    }

    // Measure naive
    const t0 = performance.now();
    for (let i = 0; i < iterations; i++) {
      naiveCheck(entities);
    }
    const naiveMs = (performance.now() - t0) / iterations;

    // Measure spatial hash
    const t1 = performance.now();
    for (let i = 0; i < iterations; i++) {
      grid.findCollisions(entities);
    }
    const spatialMs = (performance.now() - t1) / iterations;

    const winner = naiveMs < spatialMs ? 'Naive O(N^2)' : 'Spatial Hash';
    const ratio = (naiveMs < spatialMs ? spatialMs / naiveMs : naiveMs / spatialMs).toFixed(2);

    console.log(`| ${n} | ${naiveMs.toFixed(4)} ms | ${spatialMs.toFixed(4)} ms | **${winner}** | ${ratio}x |`);
  }
}

runComparison();
