import { describe, it, expect } from 'vitest';
import { World } from '../src/sim/world.js';
import { Ship, Bullet, Asteroid, Pickup } from '../src/sim/entity.js';
import { Vector2 } from '../src/sim/vector.js';

describe('client/sim collision detection', () => {
  it('detects collision when two entities overlap within sum of radii', () => {
    const world = new World();
    // Ship radius = 15, Asteroid radius = 20. Sum = 35. Distance = 20 (overlap)
    const ship = new Ship(new Vector2(100, 100));
    const asteroid = new Asteroid(new Vector2(120, 100), new Vector2(0, 0));
    world.spawn(ship);
    world.spawn(asteroid);

    world.step(0.016);
    // Ship takes 10 damage from asteroid
    expect(ship.hp).toBe(90);
    // Asteroid marked dead
    expect(asteroid.alive).toBe(false);
  });

  it('does not trigger collision when distance is greater than sum of radii', () => {
    const world = new World();
    // Ship radius = 15, Asteroid radius = 20. Distance = 100 > 35
    const ship = new Ship(new Vector2(100, 100));
    const asteroid = new Asteroid(new Vector2(200, 100), new Vector2(0, 0));
    world.spawn(ship);
    world.spawn(asteroid);

    world.step(0.016);
    expect(ship.hp).toBe(100);
    expect(asteroid.alive).toBe(true);
  });

  it('bullet hitting asteroid destroys both and awards 10 score points', () => {
    const world = new World();
    const bullet = new Bullet(new Vector2(100, 100), new Vector2(0, 0));
    const asteroid = new Asteroid(new Vector2(110, 100), new Vector2(0, 0));
    world.spawn(bullet);
    world.spawn(asteroid);

    world.step(0.016);
    expect(bullet.alive).toBe(false);
    expect(asteroid.alive).toBe(false);
    expect(world.score).toBe(10);
  });

  it('ship collecting pickup restores HP to 100 and despawns pickup', () => {
    const world = new World();
    const ship = new Ship(new Vector2(100, 100));
    ship.takeDamage(40, world); // HP drops to 60
    expect(ship.hp).toBe(60);

    const pickup = new Pickup(new Vector2(110, 100));
    world.spawn(ship);
    world.spawn(pickup);

    world.step(0.016);
    expect(ship.hp).toBe(100);
    expect(pickup.alive).toBe(false);
  });

  it('dead entities are ignored in subsequent collision steps', () => {
    const world = new World();
    const ship = new Ship(new Vector2(100, 100));
    const asteroid = new Asteroid(new Vector2(110, 100), new Vector2(0, 0));
    asteroid.alive = false; // already dead
    world.spawn(ship);
    world.spawn(asteroid);

    world.step(0.016);
    expect(ship.hp).toBe(100); // undamaged
  });

  it('collision check is symmetric between entities', () => {
    const world1 = new World();
    const s1 = new Ship(new Vector2(100, 100));
    const a1 = new Asteroid(new Vector2(115, 100), new Vector2(0, 0));
    world1.spawn(s1);
    world1.spawn(a1);
    world1.step(0.01);

    const world2 = new World();
    const s2 = new Ship(new Vector2(100, 100));
    const a2 = new Asteroid(new Vector2(115, 100), new Vector2(0, 0));
    // Spawn in reverse order
    world2.spawn(a2);
    world2.spawn(s2);
    world2.step(0.01);

    expect(s1.hp).toBe(s2.hp);
    expect(a1.alive).toBe(a2.alive);
  });

  it('entities never collide with themselves', () => {
    const world = new World();
    const ship = new Ship(new Vector2(100, 100));
    world.spawn(ship);

    world.step(0.016);
    expect(ship.hp).toBe(100);
    expect(ship.alive).toBe(true);
  });

  it('ship despawns and spawns explosion when HP drops to 0', () => {
    const world = new World();
    const ship = new Ship(new Vector2(100, 100));
    world.spawn(ship);

    ship.takeDamage(100, world);
    expect(ship.hp).toBe(0);
    expect(ship.alive).toBe(false);

    world.step(0.016);
    const explosions = Array.from(world.ofKind('explosion'));
    expect(explosions.length).toBe(1);
  });
});
