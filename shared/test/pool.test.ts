import { describe, it, expect } from 'vitest';
import { ObjectPool } from '../sim/pool.js';

describe('ObjectPool', () => {
  it('creates objects when pool is empty', () => {
    let created = 0;
    const pool = new ObjectPool(
      () => ({ id: ++created, active: true }),
      (obj) => { obj.active = false; },
    );

    const a = pool.acquire();
    const b = pool.acquire();
    expect(a.id).toBe(1);
    expect(b.id).toBe(2);
    expect(pool.availableCount).toBe(0);
  });

  it('reuses released objects and executes reset', () => {
    const pool = new ObjectPool(
      () => ({ value: 0, text: '' }),
      (obj) => {
        obj.value = 0;
        obj.text = '';
      },
      2,
    );

    expect(pool.availableCount).toBe(2);
    const obj1 = pool.acquire();
    obj1.value = 42;
    obj1.text = 'hello';

    pool.release(obj1);
    expect(pool.availableCount).toBe(2);
    expect(obj1.value).toBe(0);
    expect(obj1.text).toBe('');

    const obj2 = pool.acquire();
    expect(obj2).toBe(obj1);
  });

  it('preallocates capacity and clears items on demand', () => {
    const pool = new ObjectPool(() => ({ count: 1 }), () => {}, 5);
    expect(pool.availableCount).toBe(5);
    pool.preallocate(5);
    expect(pool.availableCount).toBe(10);
    pool.clear();
    expect(pool.availableCount).toBe(0);
  });
});
