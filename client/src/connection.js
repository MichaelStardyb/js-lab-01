export class RoomConnection extends EventTarget {
  #socket;
  #queue = [];
  #retryTimer;
  #stableTimer;
  #attempt = 0;
  #closed = false;

  constructor(url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`) {
    super();
    this.url = url;
    this.#connect();
  }

  send(message) {
    const payload = JSON.stringify({ v: 0, ...message });
    if (this.#socket?.readyState === WebSocket.OPEN) {
      this.#socket.send(payload);
    } else {
      this.#queue.push(payload);
    }
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
    this.#socket = socket;

    socket.addEventListener('open', () => {
      clearTimeout(this.#stableTimer);
      this.#stableTimer = setTimeout(() => {
        this.#attempt = 0;
      }, 5000);
      this.dispatchEvent(new Event('open'));
      while (this.#queue.length && socket.readyState === WebSocket.OPEN) {
        socket.send(this.#queue.shift());
      }
    });
    socket.addEventListener('message', ({ data }) => {
      try {
        this.dispatchEvent(new CustomEvent('message', { detail: JSON.parse(data) }));
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
}
