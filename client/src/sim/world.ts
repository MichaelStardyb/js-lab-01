import type { Entity } from './entity.js';

export class World {
    #entities = new Map<number, Entity>();
    #toDespawn = new Set<number>();
    score = 0;

    spawn(e: Entity) { this.#entities.set(e.id, e); }
    despawn(id: number) { this.#toDespawn.add(id); }
    
    *[Symbol.iterator]() { yield* this.#entities.values(); }
    *ofKind(kind: string) { 
        for (const e of this) {
            if (e.kind === kind) yield e;
        }
    }

    step(dt: number) {
        // Оновлення всіх сутностей
        for (const e of this) {
            if (e.alive) e.update(dt, this);
        }

        // Перевірка колізій (зіткнень) - O(n^2)
        const entities = Array.from(this);
        for (let i = 0; i < entities.length; i++) {
            for (let j = i + 1; j < entities.length; j++) {
                const a = entities[i];
                const b = entities[j];
                if (!a || !b || !a.alive || !b.alive) continue;
                
                const dist = a.pos.sub(b.pos).length();
                if (dist < a.radius + b.radius) {
                    a.collideWith(b, this);
                    b.collideWith(a, this);
                }
            }
        }

        // Видалення мертвих сутностей (відкладене)
        for (const id of this.#toDespawn) {
            this.#entities.delete(id);
        }
        this.#toDespawn.clear();
    }
}