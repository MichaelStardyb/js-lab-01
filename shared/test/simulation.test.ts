import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { integrate } from '../sim/ship.js';
import { mulberry32 } from '../sim/prng.js';
import { DEFAULT_ARENA } from '../sim/arena.js';

describe('shared simulation determinism', () => {
  it('produces identical states over 600 steps with identical seeds and inputs', () => {
    function simulateTrajectory(seed: number) {
      const random = mulberry32(seed);
      let ship = { x: 400, y: 300, vx: 0, vy: 0, angle: 0 };
      const history = [];
      for (let step = 0; step < 600; step += 1) {
        const input = {
          thrust: random() > 0.35,
          turnLeft: step % 4 === 0,
          turnRight: step % 7 === 0,
        };
        ship = integrate(ship, input, 1 / 30, DEFAULT_ARENA);
        if (step % 50 === 0) {
          history.push({ ...ship });
        }
      }
      return { finalShip: ship, history };
    }

    const runA = simulateTrajectory(0xD06F19);
    const runB = simulateTrajectory(0xD06F19);
    expect(runA).toEqual(runB);
  });

  it('produces different trajectories when seeds differ', () => {
    function getFinalPosition(seed: number) {
      const random = mulberry32(seed);
      let ship = { x: 400, y: 300, vx: 0, vy: 0, angle: 0 };
      for (let step = 0; step < 200; step += 1) {
        const input = {
          thrust: random() > 0.4,
          turnLeft: random() > 0.6,
          turnRight: random() > 0.6,
        };
        ship = integrate(ship, input, 1 / 30, DEFAULT_ARENA);
      }
      return ship;
    }

    const run1 = getFinalPosition(111);
    const run2 = getFinalPosition(222);
    expect(run1.x).not.toBe(run2.x);
    expect(run1.y).not.toBe(run2.y);
  });

  it('shared code contains no calls to Math.random() or Date.now()', () => {
    const sharedDir = resolve(__dirname, '../');
    function getAllSourceFiles(dir: string): string[] {
      const files: string[] = [];
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'dist' || entry === 'test') continue;
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          files.push(...getAllSourceFiles(fullPath));
        } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
          files.push(fullPath);
        }
      }
      return files;
    }

    const sourceFiles = getAllSourceFiles(sharedDir);
    expect(sourceFiles.length).toBeGreaterThan(0);

    for (const file of sourceFiles) {
      const content = readFileSync(file, 'utf8');
      expect(content).not.toMatch(/Math\.random\s*\(/);
      expect(content).not.toMatch(/Date\.now\s*\(/);
      expect(content).not.toMatch(/performance\.now\s*\(/);
    }
  });

  it('shared code contains no imports from node:* or DOM APIs', () => {
    const sharedDir = resolve(__dirname, '../');
    function getAllSourceFiles(dir: string): string[] {
      const files: string[] = [];
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'dist' || entry === 'test') continue;
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          files.push(...getAllSourceFiles(fullPath));
        } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
          files.push(fullPath);
        }
      }
      return files;
    }

    const sourceFiles = getAllSourceFiles(sharedDir);
    for (const file of sourceFiles) {
      const content = readFileSync(file, 'utf8');
      expect(content).not.toMatch(/from\s+['"]node:/);
      expect(content).not.toMatch(/window\./);
      expect(content).not.toMatch(/document\./);
    }
  });
});
