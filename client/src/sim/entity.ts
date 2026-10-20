import { Vector2 } from './vector.js';
import { gameBus } from '../events.js';
import type { World } from './world.js';

export class Entity {
    static nextId = 1;
    id: number;
    alive: boolean;
    pos: Vector2;
    vel: Vector2;
    angle: number;
    radius: number;
    kind: string;
    
    constructor(pos: Vector2, vel: Vector2, angle: number, radius: number, kind: string) {
        this.id = Entity.nextId++;
        this.alive = true;
        this.pos = pos;
        this.vel = vel;
        this.angle = angle;
        this.radius = radius;
        this.kind = kind;
    }

    update(dt: number, world?: World) {
        let p = this.pos.add(this.vel.scale(dt));
        let x = p.x;
        let y = p.y;
        // Загортання за краї екрана
        if (x < 0) x = 800;
        if (x > 800) x = 0;
        if (y < 0) y = 600;
        if (y > 600) y = 0;
        this.pos = new Vector2(x, y);
    }
    collideWith(other: Entity, world: World) {}
}

export class Ship extends Entity {
    #hp = 100;
    fireCooldown = 0;

    constructor(pos: Vector2) {
        super(pos, new Vector2(0, 0), 0, 15, 'ship');
    }
    get hp() { return this.#hp; }
    
    takeDamage(amount: number, world: World) {
        this.#hp -= amount;
        if (this.#hp <= 0 && this.alive) {
            this.alive = false;
            world.despawn(this.id);
            world.spawn(new Explosion(this.pos));
        }
    }

    update(dt: number, world?: World) {
        super.update(dt, world);
        if (this.fireCooldown > 0) this.fireCooldown -= dt;
    }

    // Стрілочна функція захищає від помилки з this у колбеках
    fire = (world: World) => {
        if (this.fireCooldown <= 0 && this.alive) {
            const dir = Vector2.fromAngle(this.angle);
            const bulletPos = this.pos.add(dir.scale(20));
            const bulletVel = this.vel.add(dir.scale(400));
            world.spawn(new Bullet(bulletPos, bulletVel));
            gameBus.dispatchEvent(new CustomEvent('fired'));
            this.fireCooldown = 0.2;
        }
    }

    collideWith(other: Entity, world: World) {
        if (other.kind === 'asteroid') {
            this.takeDamage(10, world);
            other.alive = false;
            world.despawn(other.id);
            world.spawn(new Explosion(other.pos));
        } else if (other.kind === 'pickup') {
            this.#hp = 100;
            other.alive = false;
            world.despawn(other.id);
        }
    }
}

export class Bullet extends Entity {
    ttl: number;
    homingTarget: Entity | null;
    constructor(pos: Vector2, vel: Vector2) {
        super(pos, vel, 0, 3, 'bullet');
        this.ttl = 2; // Час життя
        this.homingTarget = null; // Композиція: самонаведення
    }
    update(dt: number, world?: World) {
        super.update(dt, world);
        this.ttl -= dt;
        if (this.ttl <= 0) {
            this.alive = false;
            if (world) world.despawn(this.id);
        }
        if (this.homingTarget && this.homingTarget.alive) {
            const toTarget = this.homingTarget.pos.sub(this.pos).normalize();
            this.vel = this.vel.add(toTarget.scale(500 * dt));
        }
    }
    collideWith(other: Entity, world: World) {
        if (other.kind === 'asteroid') {
            this.alive = false;
            world.despawn(this.id);
            other.alive = false;
            world.despawn(other.id);
            world.score += 10;
            world.spawn(new Explosion(other.pos));
        }
    }
}

export class Asteroid extends Entity {
    constructor(pos: Vector2, vel: Vector2) {
        super(pos, vel, 0, 20, 'asteroid');
    }
}

export class Pickup extends Entity {
    constructor(pos: Vector2) {
        super(pos, new Vector2(0,0), 0, 10, 'pickup');
    }
}

export class Explosion extends Entity {
    ttl: number;
    particles: { pos: Vector2, vel: Vector2 }[];
    constructor(pos: Vector2) {
        super(pos, new Vector2(0,0), 0, 0, 'explosion');
        this.ttl = 0.5;
        this.particles = Array.from({length: 10}, () => ({
            pos: pos,
            vel: Vector2.fromAngle(Math.random() * Math.PI * 2).scale(Math.random() * 100)
        }));
    }
    update(dt: number, world?: World) {
        this.ttl -= dt;
        if (this.ttl <= 0) {
            this.alive = false;
            if (world) world.despawn(this.id);
        }
        for (let p of this.particles) {
            p.pos = p.pos.add(p.vel.scale(dt));
        }
    }
}