import { type Entity, Bullet, BulletPool } from './entity.js';

export class World {
    #entities = new Map<number, Entity>();
    #entityList: Entity[] = [];
    #toDespawn = new Set<number>();
    score = 0;

    spawn(e: Entity) {
        this.#entities.set(e.id, e);
        this.#entityList.push(e);
    }

    despawn(id: number) {
        this.#toDespawn.add(id);
    }
    
    *[Symbol.iterator]() {
        yield* this.#entities.values();
    }

    *ofKind(kind: string) { 
        for (const e of this.#entities.values()) {
            if (e.kind === kind) yield e;
        }
    }

    forEachOfKind(kind: string, fn: (e: Entity) => void): void {
        const len = this.#entityList.length;
        for (let i = 0; i < len; i++) {
            const e = this.#entityList[i];
            if (e && e.kind === kind && e.alive) fn(e);
        }
    }

    step(dt: number) {
        // Оновлення всіх сутностей
        const len = this.#entityList.length;
        for (let i = 0; i < len; i++) {
            const e = this.#entityList[i];
            if (e && e.alive) e.update(dt, this);
        }

        // Перевірка колізій (зіткнень) - O(n^2) без алокації проміжного масиву
        const entities = this.#entityList;
        for (let i = 0; i < len; i++) {
            const a = entities[i];
            if (!a || !a.alive) continue;
            for (let j = i + 1; j < len; j++) {
                const b = entities[j];
                if (!b || !b.alive) continue;
                
                const dist = a.pos.distanceTo(b.pos);
                if (dist < a.radius + b.radius) {
                    a.collideWith(b, this);
                    b.collideWith(a, this);
                }
            }
        }

        // Видалення мертвих сутностей (відкладене)
        if (this.#toDespawn.size > 0) {
            for (const id of this.#toDespawn) {
                const e = this.#entities.get(id);
                if (e instanceof Bullet) {
                    BulletPool.release(e);
                }
                this.#entities.delete(id);
            }
            this.#toDespawn.clear();
            this.#entityList = Array.from(this.#entities.values());
        }
    }
}
