import type { MetricsCollector } from './metrics.js';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { IncomingMessage } from 'node:http';
import { RoomGame, type GameSocket } from './game.js';
import { parseNetworkSettings, type LatencyInjector } from './latency.js';
import { TokenBucket, validateClientMessage } from './protocol.js';
import type { Room, Player } from './rooms.js';
import type { RoomManager } from './rooms.js';
import type { loadConfig } from './config.js';

type Config = ReturnType<typeof loadConfig>;

export interface DogfightSocket extends WebSocket, GameSocket {
  missedPongs: number;
  room: Room | null;
  player: Player | null;
  joining: boolean;
  bucket: TokenBucket;
  inputBucket: TokenBucket;
  latencyTimers: Set<ReturnType<typeof setTimeout>>;
  codec: string;
  injector: LatencyInjector;
  joinTimer: ReturnType<typeof setTimeout> | undefined;
  upgradeReq?: IncomingMessage;
}

function toDogfightSocket(s: unknown): s is DogfightSocket {
  return s instanceof WebSocket;
}

function hasUnref(t: unknown): t is { unref(): void } {
  return typeof t === 'object' && t !== null && 'unref' in t && typeof t.unref === 'function';
}

function playerRoster(room: Room) {
  return { v: 0, type: 'roster', players: room.roster() };
}

export function attachWebSocketServer(
  httpServer: http.Server,
  { config, roomManager, metrics }: { config: Config; roomManager: RoomManager; metrics?: MetricsCollector },
) {
  const clients = new Set<DogfightSocket>();
  const webSocketServer = new WebSocketServer({
    noServer: true,
    path: '/ws',
    maxPayload: config.maxPayloadBytes,
    perMessageDeflate: false,
  });

  webSocketServer.on('error', (error) => console.error('WebSocket server error:', error));

  function send(socket: DogfightSocket, value: unknown, { dropWhenBuffered = false } = {}): boolean {
    if (socket.readyState !== WebSocket.OPEN) return false;
    if (metrics) {
      if (Buffer.isBuffer(value) || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        metrics.recordBytesOut(value.byteLength);
      } else {
        metrics.recordBytesOut(Buffer.byteLength(JSON.stringify(value)));
      }
    }
    if (socket.bufferedAmount > config.maxBufferedAmount) {
      if (dropWhenBuffered) return false;
      socket.close(1013, 'Client is too slow');
      return false;
    }
    try {
      if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        socket.send(value, { binary: true }, (error) => {
          if (error) console.warn('WebSocket send failed:', error.message);
        });
      } else {
        socket.send(JSON.stringify(value), { binary: false }, (error) => {
          if (error) console.warn('WebSocket send failed:', error.message);
        });
      }
      return true;
    } catch (e: unknown) {
      console.warn('WebSocket send failed:', e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  function broadcast(room: Room, value: unknown, options?: { dropWhenBuffered?: boolean }): void {
    for (const socket of room.players.keys()) {
      if (toDogfightSocket(socket)) send(socket, value, options);
    }
  }

  function sendGamePacket(socket: GameSocket, value: unknown, options?: { dropWhenBuffered?: boolean; simulated?: boolean }): boolean {
    if (!toDogfightSocket(socket)) return false;
    if (options?.simulated && socket.injector) {
      socket.injector.dispatch(() => send(socket, value, options), socket.latencyTimers);
      return true;
    }
    return send(socket, value, options);
  }

  function removeFromRoom(socket: DogfightSocket): void {
    const room = socket.room;
    if (!room) return;
    socket.room = null;
    room.gameSession?.removePlayer(socket);
    if (room.players.size === 1) {
      room.gameSession = null;
    }
    room.remove(socket);
    broadcast(room, playerRoster(room));
  }

  async function joinRoom(socket: DogfightSocket, { room: roomId, name }: { room: string; name: string }): Promise<void> {
    let room: Room | null;
    do {
      room = await roomManager.getOrCreate(roomId);
    } while (room && roomManager.rooms.get(roomId) !== room);
    if (socket.readyState !== WebSocket.OPEN) return;
    if (!room) {
      send(socket, { v: 0, type: 'error', message: 'The server is at its room limit' });
      return;
    }
    if (room.players.size >= config.maxPlayersPerRoom) {
      send(socket, { v: 0, type: 'error', message: 'Room is full' });
      return;
    }

    if (!room.logFlowControlAttached) {
      room.logFlowControlAttached = true;
      room.on('logBackpressure', () => {
        for (const playerSocket of room!.players.keys()) {
          if (toDogfightSocket(playerSocket)) playerSocket.pause();
        }
      });
      room.on('logDrain', () => {
        for (const playerSocket of room!.players.keys()) {
          if (toDogfightSocket(playerSocket)) playerSocket.resume();
        }
      });
    }
    const player: Player = { id: randomUUID(), name };
    socket.room = room;
    socket.player = player;
    clearTimeout(socket.joinTimer);
    room.add(socket, player);
    room.gameSession ??= new RoomGame({ send: sendGamePacket, metrics });
    const entityId = room.gameSession.addPlayer(socket, player);
    if (room.log.backpressured) socket.pause();
    socket.codec ??= 'json';
    send(socket, { v: 0, type: 'joined', room: room.id, player, entityId, players: room.roster() });
    broadcast(room, playerRoster(room));
  }

  function onConnection(socket: DogfightSocket): void {
    clients.add(socket);
    socket.missedPongs = 0;
    socket.room = null;
    socket.player = null;
    socket.joining = false;
    socket.bucket = new TokenBucket(config.rateLimitPerSec);
    socket.inputBucket = new TokenBucket(config.inputRateLimitPerSec ?? 90);
    socket.latencyTimers = new Set();
    socket.on('error', (error: Error) => console.warn('WebSocket client error:', error.message));
    socket.on('pong', () => {
      socket.missedPongs = 0;
    });
    socket.on('close', () => {
      clearTimeout(socket.joinTimer);
      for (const timer of socket.latencyTimers) clearTimeout(timer);
      socket.latencyTimers.clear();
      clients.delete(socket);
      removeFromRoom(socket);
    });
    try {
      const requestUrl = new URL(socket.upgradeReq?.url ?? '/', `http://${socket.upgradeReq?.headers?.host ?? 'localhost'}`);
      const settings = parseNetworkSettings(requestUrl.searchParams);
      socket.codec = settings.codec;
      socket.injector = settings.injector;
    } catch (e: unknown) {
      send(socket, { v: 0, type: 'error', message: e instanceof Error ? e.message : 'Invalid network settings' });
      socket.close(1008, 'Invalid network settings');
      return;
    }
    socket.joinTimer = setTimeout(() => {
      if (!socket.room && socket.readyState === WebSocket.OPEN) {
        send(socket, { v: 0, type: 'error', message: 'Join timed out' });
        socket.close(4001, 'Join timeout');
      }
    }, config.joinTimeoutMs);
    if (hasUnref(socket.joinTimer)) socket.joinTimer.unref();

    socket.on('message', (data: unknown, isBinary: boolean) => {
      if (isBinary && socket.codec !== 'binary') {
        send(socket, { v: 0, type: 'error', message: 'Binary codec was not negotiated' });
        socket.close(1003, 'Binary codec was not negotiated');
        return;
      }
      const result = validateClientMessage(data, config.maxPayloadBytes, isBinary);
      if (result.error) {
        console.warn(`[ws] Invalid message rejected: ${result.error}`);
        send(socket, { v: 0, type: 'error', message: result.error });
        socket.close(result.closeCode ?? 1008, result.error.slice(0, 120));
        return;
      }
      const message = result.value;
      if (!message) return;
      const bucket = message.type === 'input' ? socket.inputBucket : socket.bucket;
      if (!bucket.take()) {
        send(socket, { v: 0, type: 'error', message: 'Rate limit exceeded' });
        socket.close(1008, 'Rate limit exceeded');
        return;
      }
      switch (message.type) {
        case 'join': {
          if (socket.room || socket.joining) {
            send(socket, { v: 0, type: 'error', message: 'Already joined a room' });
            socket.close(1008, 'Already joined');
            return;
          }
          socket.joining = true;
          void joinRoom(socket, message)
            .catch((e: unknown) => {
              console.error('Unable to join room:', e);
              send(socket, { v: 0, type: 'error', message: 'Unable to join room' });
            })
            .finally(() => {
              socket.joining = false;
            });
          return;
        }
        case 'leave': {
          removeFromRoom(socket);
          socket.close(1000, 'Left room');
          return;
        }
        case 'ping': {
          socket.injector.dispatch(
            () => send(socket, { v: 1, type: 'pong', time: message.time }),
            socket.latencyTimers,
          );
          return;
        }
        case 'input': {
          const room = socket.room;
          if (!room) return;
          socket.injector.dispatch(() => room.gameSession?.receiveInput(socket, message), socket.latencyTimers);
          return;
        }
        case 'chat': {
          const room = socket.room;
          if (!room) {
            send(socket, { v: 0, type: 'error', message: 'Join a room before chatting' });
            return;
          }
          const event = room.recordChat(socket.player!, message.text);
          broadcast(room, {
            v: 0,
            type: 'chat',
            id: socket.player!.id,
            name: socket.player!.name,
            text: event.text,
            timestamp: event.timestamp,
          }, { dropWhenBuffered: true });
          return;
        }
        default: {
          const _exhaustive: never = message;
          return _exhaustive;
        }
      }
    });

  }

  webSocketServer.on('connection', (webSocket) => {
    if (toDogfightSocket(webSocket)) onConnection(webSocket);
  });
  httpServer.on('upgrade', (request, socket, head) => {
    let pathname: string;
    try {
      pathname = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`).pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== '/ws') {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      if (toDogfightSocket(webSocket)) {
        webSocket.upgradeReq = request;
      }
      webSocketServer.emit('connection', webSocket, request);
    });
  });

  const heartbeat = setInterval(() => {
    for (const socket of clients) {
      if (socket.missedPongs >= 2) {
        socket.terminate();
        continue;
      }
      socket.missedPongs += 1;
      socket.ping((error?: Error) => {
        if (error) {
          console.warn('WebSocket heartbeat failed:', error.message);
          socket.terminate();
        }
      });
    }
  }, config.heartbeatIntervalMs);
  heartbeat.unref();

  async function close(): Promise<void> {
    clearInterval(heartbeat);
    for (const socket of clients) socket.close(1001, 'Server shutting down');
    if (clients.size) {
      let checkInterval: ReturnType<typeof setInterval> | undefined;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        new Promise<void>((resolveClose) => {
          const checkClosed = () => {
            if (!clients.size) {
              clearInterval(checkInterval);
              resolveClose();
            }
          };
          checkInterval = setInterval(checkClosed, 25);
          checkClosed();
        }),
        new Promise<void>((resolveTimeout) => {
          timeout = setTimeout(resolveTimeout, 2000);
        }),
      ]);
      clearInterval(checkInterval);
      clearTimeout(timeout);
      for (const socket of clients) socket.terminate();
    }
    await roomManager.close();
    await new Promise<void>((resolveClose) => webSocketServer.close(() => resolveClose()));
  }

  return { webSocketServer, clients, close };
}
