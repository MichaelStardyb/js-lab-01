import { Vector2 } from './vector.js';

export class Entity {
    static nextId = 1;
    
    constructor(pos, vel, angle, radius, kind) {
        this.id = Entity.nextId++;
        this.alive = true;
        this.pos = pos;
        this.vel = vel;
        this.angle = angle;
        this.radius = radius;
        this.kind = kind;
    }

    update(dt) {
        this.pos = this.pos.add(this.vel.scale(dt));
        // Загортання за краї екрана
        if (this.pos.x < 0) this.pos.x = 800;
        if (this.pos.x > 800) this.pos.x = 0;
        if (this.pos.y < 0) this.pos.y = 600;
        if (this.pos.y > 600) this.pos.y = 0;
    }
    collideWith(other, world) {}
}

export class Ship extends Entity {
    #hp = 100;
    fireCooldown = 0;

    constructor(pos) {
        super(pos, new Vector2(0, 0), 0, 15, 'ship');
    }
    get hp() { return this.#hp; }
    
    takeDamage(amount, world) {
        this.#hp -= amount;
        if (this.#hp <= 0 && this.alive) {
            this.alive = false;
            world.despawn(this.id);
            world.spawn(new Explosion(this.pos));
        }
    }

    update(dt) {
        super.update(dt);
        if (this.fireCooldown > 0) this.fireCooldown -= dt;
    }

    // Стрілочна функція захищає від помилки з this у колбеках
    fire = (world) => {
        if (this.fireCooldown <= 0 && this.alive) {
            const dir = Vector2.fromAngle(this.angle);
            const bulletPos = this.pos.add(dir.scale(20));
            const bulletVel = this.vel.add(dir.scale(400));
            world.spawn(new Bullet(bulletPos, bulletVel));
            this.fireCooldown = 0.2;
        }
    }

    collideWith(other, world) {
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
    constructor(pos, vel) {
        super(pos, vel, 0, 3, 'bullet');
        this.ttl = 2; // Час життя
        this.homingTarget = null; // Композиція: самонаведення
    }
    update(dt, world) {
        super.update(dt);
        this.ttl -= dt;
        if (this.ttl <= 0) {
            this.alive = false;
            world.despawn(this.id);
        }
        if (this.homingTarget && this.homingTarget.alive) {
            const toTarget = this.homingTarget.pos.sub(this.pos).normalize();
            this.vel = this.vel.add(toTarget.scale(500 * dt));
        }
    }
    collideWith(other, world) {
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
    constructor(pos, vel) {
        super(pos, vel, 0, 20, 'asteroid');
    }
}

export class Pickup extends Entity {
    constructor(pos) {
        super(pos, new Vector2(0,0), 0, 10, 'pickup');
    }
}

export class Explosion extends Entity {
    constructor(pos) {
        super(pos, new Vector2(0,0), 0, 0, 'explosion');
        this.ttl = 0.5;
        this.particles = Array.from({length: 10}, () => ({
            pos: pos,
            vel: Vector2.fromAngle(Math.random() * Math.PI * 2).scale(Math.random() * 100)
        }));
    }
    update(dt, world) {
        this.ttl -= dt;
        if (this.ttl <= 0) {
            this.alive = false;
            world.despawn(this.id);
        }
        for (let p of this.particles) {
            p.pos = p.pos.add(p.vel.scale(dt));
        }
    }
}