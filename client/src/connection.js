import { decodeSnapshot, encodeInput } from 'shared/protocol/binaryCodec';

export class RoomConnection extends EventTarget {
  #socket;
  #queue = [];
  #retryTimer;
  #stableTimer;
  #attempt = 0;
  #closed = false;

  constructor(url) {
    super();
    if (url === undefined) {
      const params = new URLSearchParams();
      const source = new URLSearchParams(location.search);
      for (const key of ['codec', 'delay', 'latency', 'jitter', 'drop']) {
        if (source.has(key)) params.set(key, source.get(key));
      }
      const query = params.toString();
      url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws${query ? `?${query}` : ''}`;
    }
    this.url = url;
    this.codec = new URL(url).searchParams.get('codec') ?? 'json';
    this.#connect();
  }

  send(message) {
    const payload = message instanceof ArrayBuffer || ArrayBuffer.isView(message)
      ? message
      : JSON.stringify({ v: message.v ?? 0, ...message });
    if (this.#socket?.readyState === WebSocket.OPEN) {
      this.#socket.send(payload);
      this.#recordTraffic('out', payload.byteLength ?? new TextEncoder().encode(payload).byteLength);
    } else {
      this.#queue.push(payload);
    }
  }

  sendInput(input) {
    if (this.#socket?.readyState !== WebSocket.OPEN) return false;
    this.send(this.codec === 'binary' ? encodeInput(input) : { v: 1, ...input });
    return true;
  }

  close() {
    this.#closed = true;
    clearTimeout(this.#retryTimer);
    clearTimeout(this.#stableTimer);
    this.#queue.length = 0;
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
        const queued = this.#queue.shift();
        socket.send(queued);
        this.#recordTraffic('out', queued.byteLength ?? new TextEncoder().encode(queued).byteLength);
      }
    });
    socket.addEventListener('message', ({ data }) => {
      try {
        this.#recordTraffic('in', data.byteLength ?? new TextEncoder().encode(data).byteLength);
        const detail = data instanceof ArrayBuffer
          ? decodeSnapshot(data)
          : JSON.parse(data);
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

  #recordTraffic(direction, bytes) {
    this.dispatchEvent(new CustomEvent('traffic', { detail: { direction, bytes, time: performance.now() } }));
  }
}
