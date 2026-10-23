import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Logger } from 'pino';
import { RoomGame, type GameSocket } from './game.js';
import { parseNetworkSettings, type LatencyInjector } from './latency.js';
import { createLogger } from './logger.js';
import type { ServerMetrics } from './metrics.js';
import { TokenBucket, validateClientMessage } from './protocol.js';
import type { Room, Player, RoomManager } from './rooms.js';
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
  clientIp?: string;
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

export function extractClientIp(request: IncomingMessage): string {
  const raw = request.headers['x-forwarded-for'];
  const forwarded = Array.isArray(raw) ? raw[0] : raw;
  if (typeof forwarded === 'string' && forwarded.trim().length > 0) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.socket?.remoteAddress ?? 'unknown';
}

export function isOriginAllowed(
  originHeader: string | undefined,
  hostHeader: string | undefined,
  allowedOrigins: readonly string[],
  forwardedHostHeader?: string | string[] | undefined,
): boolean {
  if (allowedOrigins.includes('*')) return true;

  if (allowedOrigins.length > 0) {
    if (!originHeader) return false;
    let parsedOrigin: URL;
    try {
      parsedOrigin = new URL(originHeader);
    } catch {
      return false;
    }
    return allowedOrigins.includes(parsedOrigin.origin);
  }

  // Default policy when ALLOWED_ORIGINS is empty:
  // Non-browser local test clients without Origin header are allowed
  if (!originHeader) return true;
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(originHeader);
  } catch {
    return false;
  }

  const originHost = parsedOrigin.host.toLowerCase();
  const originHostname = parsedOrigin.hostname.toLowerCase();

  // 1. Direct host match
  if (hostHeader) {
    const cleanHost = hostHeader.toLowerCase().trim();
    const cleanHostname = cleanHost.split(':')[0]!;
    if (originHost === cleanHost || originHostname === cleanHostname) {
      return true;
    }
  }

  // 2. Reverse proxy forwarded host match (e.g. Cloud Run, Nginx, Fly.io, Render)
  if (forwardedHostHeader) {
    const forwardedStr = Array.isArray(forwardedHostHeader)
      ? forwardedHostHeader.join(',')
      : forwardedHostHeader;
    const candidates = forwardedStr.split(',').map((h) => h.trim().toLowerCase());
    for (const candidate of candidates) {
      if (!candidate) continue;
      const candidateHostname = candidate.split(':')[0]!;
      if (originHost === candidate || originHostname === candidateHostname) {
        return true;
      }
    }
  }

  // 3. Localhost development
  if (originHostname === 'localhost' || originHostname === '127.0.0.1') {
    if (!hostHeader || hostHeader.startsWith('localhost') || hostHeader.startsWith('127.0.0.1')) {
      return true;
    }
  }

  // 4. Cloud Run / AI Studio preview hosts behind local proxy
  if (
    originHostname.endsWith('.run.app') ||
    originHostname.endsWith('.google.com') ||
    originHostname.endsWith('.aistudio.google.com')
  ) {
    if (
      !hostHeader ||
      hostHeader.startsWith('localhost') ||
      hostHeader.startsWith('127.0.0.1') ||
      hostHeader.startsWith('0.0.0.0')
    ) {
      return true;
    }
  }

  return false;
}

function measureByteLength(data: unknown): number {
  if (typeof data === 'string') return Buffer.byteLength(data);
  if (Buffer.isBuffer(data)) return data.byteLength;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  if (Array.isArray(data)) {
    return data.reduce((sum, item) => sum + (Buffer.isBuffer(item) ? item.byteLength : 0), 0);
  }
  return 0;
}

export function attachWebSocketServer(
  httpServer: http.Server,
  {
    config,
    roomManager,
    logger = createLogger({ level: config.logLevel, gitSha: config.gitSha }),
    metrics,
    isShuttingDown = () => false,
  }: {
    config: Config;
    roomManager: RoomManager;
    logger?: Logger;
    metrics?: ServerMetrics;
    isShuttingDown?: () => boolean;
  },
) {
  const clients = new Set<DogfightSocket>();
  const connectionsByIp = new Map<string, number>();

  const webSocketServer = new WebSocketServer({
    noServer: true,
    path: '/ws',
    maxPayload: config.maxPayloadBytes,
    perMessageDeflate: false,
  });

  webSocketServer.on('error', (error) => {
    logger.error({ event: 'ws.server_error', err: error }, 'WebSocket server error');
  });

  function send(socket: DogfightSocket, value: unknown, { dropWhenBuffered = false } = {}): boolean {
    if (socket.readyState !== WebSocket.OPEN) return false;
    if (socket.bufferedAmount > config.maxBufferedAmount) {
      if (dropWhenBuffered) return false;
      metrics?.recordRejection('slow_client');
      logger.warn(
        {
          event: 'ws.rejected',
          reason: 'slow_client',
          roomId: socket.room?.id,
          playerId: socket.player?.id,
          bufferedAmount: socket.bufferedAmount,
        },
        'Disconnecting slow client',
      );
      socket.close(1013, 'Client is too slow');
      return false;
    }
    try {
      if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        const bytes = value.byteLength;
        socket.send(value, { binary: true }, (error) => {
          if (error) {
            logger.warn(
              { event: 'ws.send_error', roomId: socket.room?.id, playerId: socket.player?.id, err: error.message },
              'WebSocket binary send failed',
            );
          }
        });
        metrics?.recordMessageOut(bytes);
      } else {
        const serialized = JSON.stringify(value);
        const bytes = Buffer.byteLength(serialized);
        socket.send(serialized, { binary: false }, (error) => {
          if (error) {
            logger.warn(
              { event: 'ws.send_error', roomId: socket.room?.id, playerId: socket.player?.id, err: error.message },
              'WebSocket JSON send failed',
            );
          }
        });
        metrics?.recordMessageOut(bytes);
      }
      return true;
    } catch (e: unknown) {
      logger.warn(
        {
          event: 'ws.send_error',
          roomId: socket.room?.id,
          playerId: socket.player?.id,
          err: e instanceof Error ? e.message : String(e),
        },
        'WebSocket send threw exception',
      );
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
    const player = socket.player;
    socket.room = null;
    room.gameSession?.removePlayer(socket);
    if (room.players.size === 1) {
      room.gameSession = null;
    }
    room.remove(socket);
    logger.info(
      { event: 'player.left', roomId: room.id, playerId: player?.id, remainingPlayers: room.players.size },
      'Player left room',
    );
    broadcast(room, playerRoster(room));
  }

  async function joinRoom(socket: DogfightSocket, { room: roomId, name }: { room: string; name: string }): Promise<void> {
    const existedBefore = roomManager.rooms.has(roomId);
    let room: Room | null;
    do {
      room = await roomManager.getOrCreate(roomId);
    } while (room && roomManager.rooms.get(roomId) !== room);
    if (socket.readyState !== WebSocket.OPEN) return;
    if (!room) {
      metrics?.recordRejection('room_limit');
      logger.warn({ event: 'ws.rejected', reason: 'room_limit', roomId }, 'Server room limit reached');
      send(socket, { v: 0, type: 'error', message: 'The server is at its room limit' });
      return;
    }
    if (!existedBefore) {
      logger.info({ event: 'room.created', roomId: room.id }, 'Room created');
    }
    if (room.players.size >= config.maxPlayersPerRoom) {
      metrics?.recordRejection('room_full');
      logger.warn({ event: 'ws.rejected', reason: 'room_full', roomId: room.id }, 'Room is full');
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
    room.gameSession ??= new RoomGame({
      send: sendGamePacket,
      onTick: (durationMs) => metrics?.recordTick(durationMs),
    });
    const entityId = room.gameSession.addPlayer(socket, player);
    if (room.log.backpressured) socket.pause();
    socket.codec ??= 'json';
    logger.info(
      { event: 'player.joined', roomId: room.id, playerId: player.id, playerName: player.name, entityId },
      'Player joined room',
    );
    send(socket, { v: 0, type: 'joined', room: room.id, player, entityId, players: room.roster() });
    broadcast(room, playerRoster(room));
  }

  function decrementIpCount(ip: string | undefined): void {
    if (!ip) return;
    const count = connectionsByIp.get(ip) ?? 0;
    if (count <= 1) connectionsByIp.delete(ip);
    else connectionsByIp.set(ip, count - 1);
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

    socket.on('error', (error: Error) => {
      logger.warn(
        { event: 'ws.client_error', roomId: socket.room?.id, playerId: socket.player?.id, err: error.message },
        'WebSocket client error',
      );
    });
    socket.on('pong', () => {
      socket.missedPongs = 0;
    });
    socket.on('close', () => {
      clearTimeout(socket.joinTimer);
      for (const timer of socket.latencyTimers) clearTimeout(timer);
      socket.latencyTimers.clear();
      clients.delete(socket);
      decrementIpCount(socket.clientIp);
      removeFromRoom(socket);
    });
    try {
      const requestUrl = new URL(socket.upgradeReq?.url ?? '/', `http://${socket.upgradeReq?.headers?.host ?? 'localhost'}`);
      const settings = parseNetworkSettings(requestUrl.searchParams);
      socket.codec = settings.codec;
      socket.injector = settings.injector;
    } catch (e: unknown) {
      metrics?.recordRejection('invalid_payload');
      const message = e instanceof Error ? e.message : 'Invalid network settings';
      logger.warn({ event: 'ws.rejected', reason: 'invalid_payload', ip: socket.clientIp, error: message }, 'Invalid WS query');
      send(socket, { v: 0, type: 'error', message });
      socket.close(1008, 'Invalid network settings');
      return;
    }
    socket.joinTimer = setTimeout(() => {
      if (!socket.room && socket.readyState === WebSocket.OPEN) {
        metrics?.recordRejection('join_timeout');
        logger.warn({ event: 'ws.rejected', reason: 'join_timeout', ip: socket.clientIp }, 'Client join timed out');
        send(socket, { v: 0, type: 'error', message: 'Join timed out' });
        socket.close(4001, 'Join timeout');
      }
    }, config.joinTimeoutMs);
    if (hasUnref(socket.joinTimer)) socket.joinTimer.unref();

    socket.on('message', (data: unknown, isBinary: boolean) => {
      metrics?.recordMessageIn(measureByteLength(data));

      if (isBinary && socket.codec !== 'binary') {
        metrics?.recordRejection('invalid_payload');
        logger.warn(
          { event: 'ws.rejected', reason: 'invalid_payload', roomId: socket.room?.id, playerId: socket.player?.id },
          'Binary frame sent without negotiating binary codec',
        );
        send(socket, { v: 0, type: 'error', message: 'Binary codec was not negotiated' });
        socket.close(1003, 'Binary codec was not negotiated');
        return;
      }
      const result = validateClientMessage(data, config.maxPayloadBytes, isBinary);
      if (result.error) {
        metrics?.recordRejection('invalid_payload');
        logger.warn(
          {
            event: 'ws.rejected',
            reason: 'invalid_payload',
            roomId: socket.room?.id,
            playerId: socket.player?.id,
            error: result.error,
          },
          'Invalid message rejected',
        );
        send(socket, { v: 0, type: 'error', message: result.error });
        socket.close(result.closeCode ?? 1008, result.error.slice(0, 120));
        return;
      }
      const message = result.value;
      if (!message) return;
      const bucket = message.type === 'input' ? socket.inputBucket : socket.bucket;
      if (!bucket.take()) {
        metrics?.recordRejection('rate_limit');
        logger.warn(
          {
            event: 'ws.rejected',
            reason: 'rate_limit',
            roomId: socket.room?.id,
            playerId: socket.player?.id,
            messageType: message.type,
          },
          'Rate limit exceeded',
        );
        send(socket, { v: 0, type: 'error', message: 'Rate limit exceeded' });
        socket.close(1008, 'Rate limit exceeded');
        return;
      }
      switch (message.type) {
        case 'join': {
          if (socket.room || socket.joining) {
            metrics?.recordRejection('invalid_payload');
            send(socket, { v: 0, type: 'error', message: 'Already joined a room' });
            socket.close(1008, 'Already joined');
            return;
          }
          socket.joining = true;
          void joinRoom(socket, message)
            .catch((e: unknown) => {
              logger.error({ event: 'room.join_error', roomId: message.room, err: e }, 'Unable to join room');
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
          logger.info({ event: 'room.chat', roomId: room.id, playerId: socket.player!.id }, 'Chat message recorded');
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
    if (isShuttingDown()) {
      metrics?.recordRejection('shutting_down');
      logger.warn({ event: 'ws.rejected', reason: 'shutting_down' }, 'Rejecting upgrade: server shutting down');
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      return;
    }

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

    const clientIp = extractClientIp(request);
    const originHeader = typeof request.headers.origin === 'string' ? request.headers.origin : undefined;
    const hostHeader = typeof request.headers.host === 'string' ? request.headers.host : undefined;
    const forwardedHost = request.headers['x-forwarded-host'];

    if (!isOriginAllowed(originHeader, hostHeader, config.allowedOrigins, forwardedHost)) {
      metrics?.recordRejection('origin');
      logger.warn(
        { event: 'ws.rejected', reason: 'origin', origin: originHeader, host: hostHeader, forwardedHost, ip: clientIp },
        'WebSocket upgrade rejected due to disallowed Origin',
      );
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }

    const activeForIp = connectionsByIp.get(clientIp) ?? 0;
    if (activeForIp >= config.maxConnectionsPerIp) {
      metrics?.recordRejection('ip_limit');
      logger.warn(
        { event: 'ws.rejected', reason: 'ip_limit', ip: clientIp, activeForIp, maxConnectionsPerIp: config.maxConnectionsPerIp },
        'WebSocket upgrade rejected due to per-IP connection limit',
      );
      socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
      return;
    }

    connectionsByIp.set(clientIp, activeForIp + 1);

    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      if (toDogfightSocket(webSocket)) {
        webSocket.upgradeReq = request;
        webSocket.clientIp = clientIp;
      }
      webSocketServer.emit('connection', webSocket, request);
    });
  });

  const heartbeat = setInterval(() => {
    for (const socket of clients) {
      if (socket.missedPongs >= 2) {
        logger.info(
          { event: 'ws.heartbeat_timeout', roomId: socket.room?.id, playerId: socket.player?.id },
          'Terminating unresponsive WebSocket client',
        );
        socket.terminate();
        continue;
      }
      socket.missedPongs += 1;
      socket.ping((error?: Error) => {
        if (error) {
          logger.warn(
            { event: 'ws.heartbeat_error', roomId: socket.room?.id, playerId: socket.player?.id, err: error.message },
            'WebSocket heartbeat ping failed',
          );
          socket.terminate();
        }
      });
    }
  }, config.heartbeatIntervalMs);
  heartbeat.unref();

  async function close(): Promise<void> {
    clearInterval(heartbeat);
    for (const socket of clients) {
      clearTimeout(socket.joinTimer);
      for (const timer of socket.latencyTimers) clearTimeout(timer);
      socket.latencyTimers.clear();
      if (socket.readyState === WebSocket.OPEN) {
        send(socket, { v: 0, type: 'shutdown', message: 'Server is shutting down' });
      }
      socket.close(1001, 'Server shutting down');
    }
    if (clients.size) {
      let checkInterval: ReturnType<typeof setInterval> | undefined;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const waitMs = Math.min(2000, config.shutdownTimeoutMs ?? 2000);
      await Promise.race([
        new Promise<void>((resolveClose) => {
          const checkClosed = () => {
            if (!clients.size) {
              clearInterval(checkInterval);
              resolveClose();
            }
          };
          checkInterval = setInterval(checkClosed, 20);
          checkClosed();
        }),
        new Promise<void>((resolveTimeout) => {
          timeout = setTimeout(resolveTimeout, waitMs);
        }),
      ]);
      clearInterval(checkInterval);
      clearTimeout(timeout);
      for (const socket of clients) socket.terminate();
    }
    connectionsByIp.clear();
    await roomManager.close();
    await new Promise<void>((resolveClose) => webSocketServer.close(() => resolveClose()));
  }

  return { webSocketServer, clients, connectionsByIp, close };
}
