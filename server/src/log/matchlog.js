import { EventEmitter } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export class NdjsonTransform extends Transform {
  constructor() {
    super({ writableObjectMode: true });
  }

  _transform(event, _encoding, callback) {
    try {
      callback(null, `${JSON.stringify(event)}\n`);
    } catch (error) {
      callback(error);
    }
  }
}

export class RoomLog extends EventEmitter {
  constructor(filePath, { maxQueuedEvents = 2048 } = {}) {
    super();
    this.filePath = filePath;
    this.maxQueuedEvents = maxQueuedEvents;
    this.queue = [];
    this.waiter = null;
    this.closing = false;
    this.droppedEvents = 0;
    this.warnedAboutDrops = false;
    this.backpressured = false;
    this.ready = mkdir(dirname(filePath), { recursive: true });
    this.done = this.#start();
    this.done.catch((error) => this.emit('error', error));
  }

  static filePath(logDir, roomId) {
    return join(logDir, `${encodeURIComponent(roomId)}-${Date.now()}.ndjson`);
  }

  write(event) {
    if (this.closing) return false;
    if (this.queue.length >= this.maxQueuedEvents) {
      this.droppedEvents += 1;
      if (!this.warnedAboutDrops) {
        this.warnedAboutDrops = true;
        console.error(`Room log ${this.filePath} is backpressured; subsequent events may be omitted`);
      }
      return false;
    }
    this.queue.push(event);
    if (this.queue.length >= this.maxQueuedEvents) {
      this.backpressured = true;
      this.emit('backpressure');
    }
    this.#wake();
    return !this.backpressured;
  }

  async close() {
    this.closing = true;
    this.#wake();
    await this.done;
    if (this.droppedEvents) {
      console.error(`Room log ${this.filePath} omitted ${this.droppedEvents} events due to sustained backpressure`);
    }
  }

  #wake() {
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.();
  }

  async *#events() {
    while (this.queue.length || !this.closing) {
      if (this.queue.length) {
        yield this.queue.shift();
        if (this.backpressured && this.queue.length <= Math.floor(this.maxQueuedEvents / 2)) {
          this.backpressured = false;
          this.emit('drain');
        }
      } else {
        await new Promise((resolve) => {
          this.waiter = resolve;
        });
      }
    }
  }

  async #start() {
    await this.ready;
    await pipeline(
      Readable.from(this.#events(), { objectMode: true }),
      new NdjsonTransform(),
      createWriteStream(this.filePath, { flags: 'a' }),
    );
  }
}
