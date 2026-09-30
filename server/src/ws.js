import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { RoomGame } from './game.js';
import { parseNetworkSettings } from './latency.js';
import { TokenBucket, validateClientMessage } from './protocol.js';

function playerRoster(room) {
  return { v: 0, type: 'roster', players: room.roster() };
}

export function attachWebSocketServer(httpServer, { config, roomManager }) {
  const clients = new Set();
  const webSocketServer = new WebSocketServer({
    noServer: true,
    path: '/ws',
    maxPayload: config.maxPayloadBytes,
    perMessageDeflate: false,
  });

  webSocketServer.on('error', (error) => console.error('WebSocket server error:', error));

  function send(socket, value, { dropWhenBuffered = false } = {}) {
    if (socket.readyState !== WebSocket.OPEN) return false;
    if (socket.bufferedAmount > config.maxBufferedAmount) {
      if (dropWhenBuffered) return false;
      socket.close(1013, 'Client is too slow');
      return false;
    }
    try {
      const isBinary = value instanceof ArrayBuffer || ArrayBuffer.isView(value);
      socket.send(isBinary ? value : JSON.stringify(value), { binary: isBinary }, (error) => {
        if (error) console.warn('WebSocket send failed:', error.message);
      });
      return true;
    } catch (error) {
      console.warn('WebSocket send failed:', error.message);
      return false;
    }
  }

  function broadcast(room, value, options) {
    for (const socket of room.players.keys()) send(socket, value, options);
  }

  function sendGamePacket(socket, value, options) {
    if (options?.simulated && socket.injector) {
      socket.injector.dispatch(() => send(socket, value, options), socket.latencyTimers);
      return true;
    }
    return send(socket, value, options);
  }

  function removeFromRoom(socket) {
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

  async function joinRoom(socket, { room: roomId, name }) {
    let room;
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
        for (const playerSocket of room.players.keys()) playerSocket.pause();
      });
      room.on('logDrain', () => {
        for (const playerSocket of room.players.keys()) playerSocket.resume();
      });
    }
    const player = { id: randomUUID(), name };
    socket.room = room;
    socket.player = player;
    clearTimeout(socket.joinTimer);
    room.add(socket, player);
    room.gameSession ??= new RoomGame({ send: sendGamePacket });
    const entityId = room.gameSession.addPlayer(socket, player);
    if (room.log.backpressured) socket.pause();
    socket.codec ??= 'json';
    send(socket, { v: 0, type: 'joined', room: room.id, player, entityId, players: room.roster() });
    broadcast(room, playerRoster(room));
  }

  function onConnection(socket) {
    clients.add(socket);
    socket.missedPongs = 0;
    socket.room = null;
    socket.player = null;
    socket.joining = false;
    socket.bucket = new TokenBucket(config.rateLimitPerSec);
    socket.inputBucket = new TokenBucket(config.inputRateLimitPerSec ?? 90);
    socket.latencyTimers = new Set();
    socket.on('error', (error) => console.warn('WebSocket client error:', error.message));
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
    } catch (error) {
      send(socket, { v: 0, type: 'error', message: error.message });
      socket.close(1008, 'Invalid network settings');
      return;
    }
    socket.joinTimer = setTimeout(() => {
      if (!socket.room && socket.readyState === WebSocket.OPEN) {
        send(socket, { v: 0, type: 'error', message: 'Join timed out' });
        socket.close(4001, 'Join timeout');
      }
    }, config.joinTimeoutMs);
    socket.joinTimer.unref?.();

    socket.on('message', (data, isBinary) => {
      if (isBinary && socket.codec !== 'binary') {
        send(socket, { v: 0, type: 'error', message: 'Binary codec was not negotiated' });
        socket.close(1003, 'Binary codec was not negotiated');
        return;
      }
      const result = validateClientMessage(data, config.maxPayloadBytes, isBinary);
      if (result.error) {
        send(socket, { v: 0, type: 'error', message: result.error });
        socket.close(result.closeCode ?? 1008, result.error.slice(0, 120));
        return;
      }
      const message = result.value;
      const bucket = message.type === 'input' ? socket.inputBucket : socket.bucket;
      if (!bucket.take()) {
        send(socket, { v: 0, type: 'error', message: 'Rate limit exceeded' });
        socket.close(1008, 'Rate limit exceeded');
        return;
      }
      if (message.type === 'join') {
        if (socket.room || socket.joining) {
          send(socket, { v: 0, type: 'error', message: 'Already joined a room' });
          socket.close(1008, 'Already joined');
          return;
        }
        socket.joining = true;
        void joinRoom(socket, message)
          .catch((error) => {
            console.error('Unable to join room:', error);
            send(socket, { v: 0, type: 'error', message: 'Unable to join room' });
          })
          .finally(() => {
            socket.joining = false;
          });
        return;
      }
      if (message.type === 'leave') {
        removeFromRoom(socket);
        socket.close(1000, 'Left room');
        return;
      }

      const room = socket.room;
      if (message.type === 'ping') {
        socket.injector.dispatch(
          () => send(socket, { v: 1, type: 'pong', time: message.time }),
          socket.latencyTimers,
        );
        return;
      }
      if (message.type === 'input') {
        if (!room) return;
        socket.injector.dispatch(() => room.gameSession?.receiveInput(socket, message), socket.latencyTimers);
        return;
      }
      if (!room) {
        send(socket, { v: 0, type: 'error', message: 'Join a room before chatting' });
        return;
      }
      const event = room.recordChat(socket.player, message.text);
      broadcast(room, {
        v: 0,
        type: 'chat',
        id: socket.player.id,
        name: socket.player.name,
        text: event.text,
        timestamp: event.timestamp,
      }, { dropWhenBuffered: true });
    });

  }

  webSocketServer.on('connection', onConnection);
  httpServer.on('upgrade', (request, socket, head) => {
    let pathname;
    try {
      pathname = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`).pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== '/ws') {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocket.upgradeReq = request;
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
      socket.ping((error) => {
        if (error) {
          console.warn('WebSocket heartbeat failed:', error.message);
          socket.terminate();
        }
      });
    }
  }, config.heartbeatIntervalMs);
  heartbeat.unref?.();

  async function close() {
    clearInterval(heartbeat);
    for (const socket of clients) socket.close(1001, 'Server shutting down');
    if (clients.size) {
      let checkInterval;
      let timeout;
      await Promise.race([
        new Promise((resolveClose) => {
          const checkClosed = () => {
            if (!clients.size) {
              clearInterval(checkInterval);
              resolveClose();
            }
          };
          checkInterval = setInterval(checkClosed, 25);
          checkClosed();
        }),
        new Promise((resolveTimeout) => {
          timeout = setTimeout(resolveTimeout, 2000);
        }),
      ]);
      clearInterval(checkInterval);
      clearTimeout(timeout);
      for (const socket of clients) socket.terminate();
    }
    await roomManager.close();
    await new Promise((resolveClose) => webSocketServer.close(resolveClose));
  }

  return { webSocketServer, clients, close };
}
