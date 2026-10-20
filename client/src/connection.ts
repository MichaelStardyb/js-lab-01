import { decodeSnapshot, encodeInput, type SnapshotMessage } from 'shared/protocol/binaryCodec.js';
import { type EntityId, type Seq, asEntityId } from 'shared/protocol/schema.js';

export type ServerMessage =
  | { type: 'roster'; players?: Array<string | { name: string }>; roster?: Array<string | { name: string }> }
  | { type: 'joined'; entityId: EntityId; players?: Array<string | { name: string }>; roster?: Array<string | { name: string }> }
  | SnapshotMessage
  | { type: 'pong'; time: number }
  | { type: 'chat'; name?: string; from?: string; text: string }
  | { type: 'event'; event: { type: 'chat' | 'asteroid_destroyed' | 'pickup'; name?: string; text?: string } }
  | { type: 'error'; message: string };

type RoomConnectionEventMap = {
  message: CustomEvent<ServerMessage>;
  roster: CustomEvent<unknown>;
  joined: CustomEvent<{ entityId: EntityId }>;
  open: CustomEvent<void>;
  close: CustomEvent<void>;
  traffic: CustomEvent<{ direction: string; bytes: number; time: number }>;
};

class TypedEventTarget extends EventTarget {
  addEventListener<K extends keyof RoomConnectionEventMap>(
    type: K,
    listener: (this: TypedEventTarget, ev: RoomConnectionEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ): void {
    super.addEventListener(type, listener, options);
  }
}

export type InputPayload = {
  seq: Seq;
  thrust: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  fire: boolean;
};

export class RoomConnection extends TypedEventTarget {
  #socket: WebSocket | null = null;
  #worker: Worker | null = null;
  #queue: (string | ArrayBuffer | ArrayBufferView)[] = [];
  #retryTimer?: ReturnType<typeof setTimeout>;
  #stableTimer?: ReturnType<typeof setTimeout>;
  #attempt = 0;
  #closed = false;
  url: string;
  codec: string;

  constructor(url?: string) {
    super();
    if (url === undefined) {
      const params = new URLSearchParams();
      const source = new URLSearchParams(location.search);
      for (const key of ['codec', 'delay', 'latency', 'jitter', 'drop', 'worker']) {
        if (source.has(key)) params.set(key, source.get(key) || '');
      }
      const query = params.toString();
      url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws${query ? `?${query}` : ''}`;
    }
    this.url = url;
    this.codec = new URL(url).searchParams.get('codec') ?? 'json';

    const workerParam = typeof location !== 'undefined'
      ? new URLSearchParams(location.search).get('worker')
      : null;
    if (workerParam === '1' && typeof Worker !== 'undefined') {
      try {
        this.#worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
        this.#worker.addEventListener('message', (event: MessageEvent<{ success: boolean; snapshot?: ServerMessage; error?: string }>) => {
          if (event.data.success && event.data.snapshot) {
            this.dispatchEvent(new CustomEvent('message', { detail: event.data.snapshot }));
          } else {
            this.dispatchEvent(new CustomEvent('error', { detail: new Error(event.data.error ?? 'Worker decode failed') }));
          }
        });
      } catch {
        this.#worker = null;
      }
    }

    this.#connect();
  }

  send(message: string | ArrayBuffer | ArrayBufferView | Record<string, unknown>) {
    const payload: string | ArrayBuffer | ArrayBufferView = message instanceof ArrayBuffer || ArrayBuffer.isView(message)
      ? message
      : typeof message === 'string'
      ? message
      : JSON.stringify(
          typeof message === 'object' && message !== null && 'v' in message && typeof message['v'] === 'number'
            ? message
            : { v: 0, ...message }
        );
    if (this.#socket?.readyState === WebSocket.OPEN) {
      this.#socket.send(payload);
      const byteLen = typeof payload === 'string'
        ? new TextEncoder().encode(payload).byteLength
        : payload.byteLength;
      this.#recordTraffic('out', byteLen);
    } else {
      this.#queue.push(payload);
    }
  }

  sendInput(input: InputPayload) {
    if (this.#socket?.readyState !== WebSocket.OPEN) return false;
    const fullInput: {
      v: 1;
      type: 'input';
      seq: Seq;
      thrust: boolean;
      turnLeft: boolean;
      turnRight: boolean;
      fire: boolean;
    } = {
      v: 1,
      type: 'input',
      seq: input.seq,
      thrust: input.thrust,
      turnLeft: input.turnLeft,
      turnRight: input.turnRight,
      fire: input.fire,
    };
    this.send(this.codec === 'binary' ? encodeInput(fullInput) : fullInput);
    return true;
  }

  close() {
    this.#closed = true;
    clearTimeout(this.#retryTimer);
    clearTimeout(this.#stableTimer);
    this.#queue.length = 0;
    this.#worker?.terminate();
    this.#worker = null;
    this.#socket?.close(1000, 'Client left');
  }

  #connect() {
    if (this.#closed) return;
    const socket = new WebSocket(this.url);
    socket.binaryType = 'arraybuffer';
    this.#socket = socket;

    socket.addEventListener('open', () => {
      clearTimeout(this.#stableTimer);
      this.#stableTimer = setTimeout(() => {
        this.#attempt = 0;
      }, 5000);
      this.dispatchEvent(new Event('open'));
      while (this.#queue.length && socket.readyState === WebSocket.OPEN) {
        const queued = this.#queue.shift()!;
        socket.send(queued);
        const byteLen = typeof queued === 'string'
          ? new TextEncoder().encode(queued).byteLength
          : queued.byteLength;
        this.#recordTraffic('out', byteLen);
      }
    });
    socket.addEventListener('message', ({ data }: MessageEvent) => {
      try {
        const byteLen = typeof data === 'string'
          ? new TextEncoder().encode(data).byteLength
          : data instanceof ArrayBuffer
          ? data.byteLength
          : 0;
        this.#recordTraffic('in', byteLen);
        if (data instanceof ArrayBuffer && this.#worker) {
          this.#worker.postMessage({ buffer: data }, [data]);
          return;
        }
        const parsedData = data instanceof ArrayBuffer
          ? decodeSnapshot(data)
          : JSON.parse(data);
        const detail: ServerMessage = parsedData && typeof parsedData === 'object' && 'type' in parsedData && parsedData.type === 'joined' && 'entityId' in parsedData && typeof parsedData.entityId === 'number'
          ? { ...parsedData, entityId: asEntityId(parsedData.entityId) }
          : parsedData;
        this.dispatchEvent(new CustomEvent('message', { detail }));
      } catch {
        this.dispatchEvent(new CustomEvent('error', { detail: new Error('Invalid server message') }));
      }
    });
    socket.addEventListener('error', () => {
      this.dispatchEvent(new CustomEvent('error', { detail: new Error('WebSocket connection error') }));
    });
    socket.addEventListener('close', () => {
      clearTimeout(this.#stableTimer);
      this.dispatchEvent(new Event('close'));
      if (this.#closed) return;
      const base = Math.min(1000 * 2 ** this.#attempt, 30000);
      const delay = base * (0.75 + Math.random() * 0.5);
      this.#attempt += 1;
      this.#retryTimer = setTimeout(() => this.#connect(), delay);
    });
  }

  #recordTraffic(direction: 'in' | 'out', bytes: number) {
    this.dispatchEvent(new CustomEvent('traffic', { detail: { direction, bytes, time: performance.now() } }));
  }
}
