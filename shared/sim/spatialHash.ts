export interface SpatialEntity {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export interface CollisionPair<T extends SpatialEntity> {
  readonly a: T;
  readonly b: T;
}

export class SpatialHashGrid<T extends SpatialEntity> {
  readonly #cellSize: number;
  readonly #cols: number;
  readonly #rows: number;
  readonly #width: number;
  readonly #height: number;
  readonly #cells: T[][];

  constructor(width: number, height: number, cellSize = 64) {
    this.#width = width;
    this.#height = height;
    this.#cellSize = cellSize;
    this.#cols = Math.ceil(width / cellSize);
    this.#rows = Math.ceil(height / cellSize);
    const totalCells = this.#cols * this.#rows;
    this.#cells = new Array(totalCells);
    for (let i = 0; i < totalCells; i++) {
      this.#cells[i] = [];
    }
  }

  clear(): void {
    const len = this.#cells.length;
    for (let i = 0; i < len; i++) {
      this.#cells[i]!.length = 0;
    }
  }

  #cellIndex(col: number, row: number): number {
    const c = ((col % this.#cols) + this.#cols) % this.#cols;
    const r = ((row % this.#rows) + this.#rows) % this.#rows;
    return r * this.#cols + c;
  }

  insert(entity: T): void {
    const minCol = Math.floor((entity.x - entity.radius) / this.#cellSize);
    const maxCol = Math.floor((entity.x + entity.radius) / this.#cellSize);
    const minRow = Math.floor((entity.y - entity.radius) / this.#cellSize);
    const maxRow = Math.floor((entity.y + entity.radius) / this.#cellSize);

    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        const idx = this.#cellIndex(c, r);
        this.#cells[idx]!.push(entity);
      }
    }
  }

  findCollisions(entities: readonly T[]): CollisionPair<T>[] {
    this.clear();
    const count = entities.length;
    for (let i = 0; i < count; i++) {
      this.insert(entities[i]!);
    }

    const testedPairs = new Set<number>();
    const collisions: CollisionPair<T>[] = [];

    const totalCells = this.#cells.length;
    for (let cellIdx = 0; cellIdx < totalCells; cellIdx++) {
      const cell = this.#cells[cellIdx]!;
      const cellLen = cell.length;
      if (cellLen < 2) continue;

      for (let i = 0; i < cellLen; i++) {
        const a = cell[i]!;
        for (let j = i + 1; j < cellLen; j++) {
          const b = cell[j]!;
          const minId = Math.min(a.id, b.id);
          const maxId = Math.max(a.id, b.id);
          // 32-bit unique pair key: (minId << 16) | maxId
          const pairKey = (minId << 16) | (maxId & 0xFFFF);
          if (testedPairs.has(pairKey)) continue;
          testedPairs.add(pairKey);

          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const distSq = dx * dx + dy * dy;
          const radSum = a.radius + b.radius;
          if (distSq < radSum * radSum) {
            collisions.push(a.id < b.id ? { a, b } : { a: b, b: a });
          }
        }
      }
    }

    // Sort deterministically by id of first then second entity
    collisions.sort((p1, p2) => (p1.a.id !== p2.a.id ? p1.a.id - p2.a.id : p1.b.id - p2.b.id));
    return collisions;
  }
}
