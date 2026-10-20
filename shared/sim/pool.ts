export class ObjectPool<T> {
  readonly #factory: () => T;
  readonly #reset: (item: T) => void;
  readonly #pool: T[] = [];

  constructor(factory: () => T, reset: (item: T) => void, initialCapacity = 0) {
    this.#factory = factory;
    this.#reset = reset;
    if (initialCapacity > 0) {
      this.preallocate(initialCapacity);
    }
  }

  get availableCount(): number {
    return this.#pool.length;
  }

  preallocate(count: number): void {
    for (let i = 0; i < count; i++) {
      this.#pool.push(this.#factory());
    }
  }

  acquire(): T {
    const item = this.#pool.pop();
    if (item !== undefined) {
      return item;
    }
    return this.#factory();
  }

  release(item: T): void {
    this.#reset(item);
    this.#pool.push(item);
  }

  clear(): void {
    this.#pool.length = 0;
  }
}
