import { describe, it, expect } from 'vitest';
import { World } from '../src/sim/world.js';
import { Entity, Ship, Bullet, Asteroid, Pickup } from '../src/sim/entity.js';
import { Vector2 } from '../src/sim/vector.js';

describe('client/sim/world World', () => {
  it('spawns entities and assigns unique incrementing IDs', () => {
    const world = new World();
    const e1 = new Entity(new Vector2(0, 0), new Vector2(0, 0), 0, 10, 'custom');
    const e2 = new Entity(new Vector2(10, 10), new Vector2(0, 0), 0, 10, 'custom');
    world.spawn(e1);
    world.spawn(e2);

    expect(e2.id).toBeGreaterThan(e1.id);
    const entities = Array.from(world);
    expect(entities.length).toBe(2);
    expect(entities).toContain(e1);
    expect(entities).toContain(e2);
  });

  it('filters entities by kind using ofKind generator', () => {
    const world = new World();
    const ship = new Ship(new Vector2(100, 100));
    const asteroid = new Asteroid(new Vector2(200, 200), new Vector2(0, 0));
    const bullet = new Bullet(new Vector2(300, 300), new Vector2(0, 0));

    world.spawn(ship);
    world.spawn(asteroid);
    world.spawn(bullet);

    const ships = Array.from(world.ofKind('ship'));
    const asteroids = Array.from(world.ofKind('asteroid'));
    const bullets = Array.from(world.ofKind('bullet'));

    expect(ships).toEqual([ship]);
    expect(asteroids).toEqual([asteroid]);
    expect(bullets).toEqual([bullet]);
  });

  it('despawns marked entities during deferred sweep in step', () => {
    const world = new World();
    const ship = new Ship(new Vector2(100, 100));
    world.spawn(ship);

    world.despawn(ship.id);
    // Before step, entity still exists in map
    expect(Array.from(world).length).toBe(1);

    // Step performs sweep
    world.step(0.016);
    expect(Array.from(world).length).toBe(0);
  });

  it('decrements bullet TTL each step and despawns upon expiration', () => {
    const world = new World();
    const bullet = new Bullet(new Vector2(100, 100), new Vector2(10, 0));
    world.spawn(bullet);
    expect(bullet.ttl).toBe(2);

    world.step(1.0);
    expect(bullet.ttl).toBeCloseTo(1.0, 3);
    expect(bullet.alive).toBe(true);

    world.step(1.1); // total elapsed 2.1s > 2.0s
    expect(bullet.alive).toBe(false);
    expect(Array.from(world).length).toBe(0);
  });

  it('updates ship position based on velocity and dt', () => {
    const world = new World();
    const entity = new Entity(new Vector2(100, 100), new Vector2(50, -20), 0, 10, 'particle');
    world.spawn(entity);

    world.step(1.0);
    expect(entity.pos.x).toBe(150);
    expect(entity.pos.y).toBe(80);
  });

  it('tracks game score across world events', () => {
    const world = new World();
    expect(world.score).toBe(0);
    world.score += 50;
    expect(world.score).toBe(50);
  });

  it('does not resurrect or reuse despawned entity IDs', () => {
    const world = new World();
    const e1 = new Entity(new Vector2(0, 0), new Vector2(0, 0), 0, 5, 'a');
    world.spawn(e1);
    const id1 = e1.id;
    world.despawn(id1);
    world.step(0.01);

    const e2 = new Entity(new Vector2(0, 0), new Vector2(0, 0), 0, 5, 'b');
    world.spawn(e2);
    expect(e2.id).toBeGreaterThan(id1);
  });

  it('handles multiple concurrent despawns in the same step', () => {
    const world = new World();
    const e1 = new Entity(new Vector2(0, 0), new Vector2(0, 0), 0, 5, 'a');
    const e2 = new Entity(new Vector2(10, 10), new Vector2(0, 0), 0, 5, 'b');
    world.spawn(e1);
    world.spawn(e2);

    world.despawn(e1.id);
    world.despawn(e2.id);
    world.step(0.01);

    expect(Array.from(world).length).toBe(0);
  });
});
