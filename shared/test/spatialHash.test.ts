import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { SpatialHashGrid, type SpatialEntity, type CollisionPair } from '../sim/spatialHash.js';

function naiveFindCollisions<T extends SpatialEntity>(entities: readonly T[]): CollisionPair<T>[] {
  const collisions: CollisionPair<T>[] = [];
  const len = entities.length;
  for (let i = 0; i < len; i++) {
    const a = entities[i]!;
    for (let j = i + 1; j < len; j++) {
      const b = entities[j]!;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const distSq = dx * dx + dy * dy;
      const radSum = a.radius + b.radius;
      if (distSq < radSum * radSum) {
        collisions.push(a.id < b.id ? { a, b } : { a: b, b: a });
      }
    }
  }
  collisions.sort((p1, p2) => (p1.a.id !== p2.a.id ? p1.a.id - p2.a.id : p1.b.id - p2.b.id));
  return collisions;
}

describe('SpatialHashGrid', () => {
  it('correctly detects overlapping circles', () => {
    const grid = new SpatialHashGrid(800, 600, 64);
    const entities = [
      { id: 1, x: 100, y: 100, radius: 15 },
      { id: 2, x: 110, y: 100, radius: 15 }, // Overlap with 1
      { id: 3, x: 500, y: 500, radius: 10 }, // Isolated
    ];

    const collisions = grid.findCollisions(entities);
    expect(collisions.length).toBe(1);
    expect(collisions[0]!.a.id).toBe(1);
    expect(collisions[0]!.b.id).toBe(2);
  });

  it('maintains strict determinism across multiple runs', () => {
    const grid = new SpatialHashGrid(800, 600, 64);
    const entities = [
      { id: 10, x: 200, y: 200, radius: 20 },
      { id: 5, x: 210, y: 200, radius: 20 },
      { id: 15, x: 205, y: 210, radius: 20 },
    ];

    const res1 = grid.findCollisions(entities).map((p) => `${p.a.id}-${p.b.id}`);
    const res2 = grid.findCollisions(entities).map((p) => `${p.a.id}-${p.b.id}`);
    expect(res1).toEqual(res2);
    expect(res1).toEqual(['5-10', '5-15', '10-15']);
  });

  it('property: matches naive O(n^2) collisions exactly on arbitrary configurations', () => {
    const grid = new SpatialHashGrid(800, 600, 64);

    const entityArb = fc.record({
      id: fc.integer({ min: 1, max: 1000 }),
      x: fc.double({ min: 50, max: 750, noNaN: true }),
      y: fc.double({ min: 50, max: 550, noNaN: true }),
      radius: fc.double({ min: 5, max: 30, noNaN: true }),
    });

    fc.assert(
      fc.property(
        fc.uniqueArray(entityArb, { selector: (e) => e.id, minLength: 2, maxLength: 40 }),
        (entities) => {
          const spatial = grid.findCollisions(entities).map((p) => `${p.a.id}:${p.b.id}`);
          const naive = naiveFindCollisions(entities).map((p) => `${p.a.id}:${p.b.id}`);
          expect(spatial).toEqual(naive);
        },
      ),
      { numRuns: 300 },
    );
  });
});
