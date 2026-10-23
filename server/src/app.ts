import { createReadStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { pipeline } from 'node:stream/promises';
import type { Logger } from 'pino';
import { loadConfig } from './config.js';
import { createLogger, flushLogger } from './logger.js';
import { handleReplayRequest } from './log/replay.js';
import { ServerMetrics } from './metrics.js';
import { RoomManager } from './rooms.js';
import { validateRoomId } from './protocol.js';
import { attachWebSocketServer } from './ws.js';

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const defaultStaticDirectory = resolve(projectDirectory, 'client', 'dist');
const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.mp3', 'audio/mpeg'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
]);

function respondJson(response: ServerResponse, statusCode: number, body: unknown) {
  if (response.headersSent || response.destroyed) return;
  const content = JSON.stringify(body);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(content),
    'cache-control': 'no-store',
  });
  response.end(content);
}

function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolveBody, rejectBody) => {
    let body = '';
    let settled = false;
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      if (settled) return;
      if (Buffer.byteLength(body) + Buffer.byteLength(chunk) > maxBytes) {
        settled = true;
        rejectBody(Object.assign(new Error('Request body is too large'), { statusCode: 413 }));
        request.resume();
        return;
      }
      body += chunk;
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        resolveBody(JSON.parse(body));
      } catch {
        rejectBody(Object.assign(new Error('Request body must be valid JSON'), { statusCode: 400 }));
      }
    });
    request.on('error', (error: unknown) => {
      if (!settled) rejectBody(error);
    });
  });
}

export function createHttpHandler({
  config,
  roomManager,
  staticDir,
  metrics,
  logger,
  isShuttingDown = () => false,
}: {
  config: ReturnType<typeof loadConfig>;
  roomManager: RoomManager;
  staticDir: string | null;
  metrics: ServerMetrics;
  logger: Logger;
  isShuttingDown?: () => boolean;
}) {
  return async function handleRequest(request: IncomingMessage, response: ServerResponse) {
    const rawPath = (request.url ?? '').split('?', 1)[0];
    let decodedRawPath: string;
    try {
      decodedRawPath = decodeURIComponent(rawPath!);
    } catch {
      respondJson(response, 400, { error: 'Invalid path' });
      return;
    }
    if (decodedRawPath.includes('..')) {
      respondJson(response, 403, { error: 'Forbidden' });
      return;
    }

    let url: URL;
    try {
      url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    } catch {
      respondJson(response, 400, { error: 'Invalid request URL' });
      return;
    }

    if (url.pathname === '/health') {
      if (request.method !== 'GET') {
        response.setHeader('allow', 'GET');
        respondJson(response, 405, { error: 'Method not allowed' });
        return;
      }
      respondJson(response, 200, {
        status: 'ok',
        version: '1.0.0',
        gitSha: config.gitSha,
        uptime: process.uptime(),
        eventLoopUtilization: metrics.sampleEventLoopUtilization(),
      });
      return;
    }

    if (url.pathname === '/ready') {
      if (request.method !== 'GET') {
        response.setHeader('allow', 'GET');
        respondJson(response, 405, { error: 'Method not allowed' });
        return;
      }
      if (isShuttingDown()) {
        respondJson(response, 503, {
          status: 'not_ready',
          reason: 'shutting_down',
          gitSha: config.gitSha,
        });
        return;
      }
      if (roomManager.rooms.size >= config.maxRooms) {
        respondJson(response, 503, {
          status: 'not_ready',
          reason: 'room_limit_reached',
          rooms: roomManager.rooms.size,
          maxRooms: config.maxRooms,
          gitSha: config.gitSha,
        });
        return;
      }
      respondJson(response, 200, {
        status: 'ready',
        version: '1.0.0',
        gitSha: config.gitSha,
        rooms: roomManager.rooms.size,
        maxRooms: config.maxRooms,
      });
      return;
    }

    if (url.pathname === '/metrics') {
      if (request.method !== 'GET') {
        response.setHeader('allow', 'GET');
        respondJson(response, 405, { error: 'Method not allowed' });
        return;
      }
      const wantsJson =
        url.searchParams.get('format') === 'json' ||
        (request.headers.accept ?? '').includes('application/json');
      if (wantsJson) {
        respondJson(response, 200, {
          version: '1.0.0',
          gitSha: config.gitSha,
          ...metrics.getSnapshot(),
        });
        return;
      }
      const text = await metrics.toPrometheusText();
      if (!response.headersSent && !response.destroyed) {
        response.writeHead(200, {
          'content-type': metrics.registry.contentType,
          'content-length': Buffer.byteLength(text),
          'cache-control': 'no-store',
        });
        response.end(text);
      }
      return;
    }

    if (url.pathname === '/api/rooms') {
      if (request.method === 'GET') {
        const rooms = [...roomManager.rooms.values()].map((room) => ({
          id: room.id,
          name: room.id,
          players: room.players.size,
          playerCount: room.players.size,
        }));
        respondJson(response, 200, rooms);
        return;
      }
      if (request.method === 'POST') {
        if (isShuttingDown()) {
          respondJson(response, 503, { error: 'Server is shutting down' });
          return;
        }
        try {
          const body = await readJsonBody(request, 1024);
          const name = body && typeof body === 'object' && 'name' in body && typeof body.name === 'string' ? body.name.trim() : '';
          const id = body && typeof body === 'object' && 'id' in body && typeof body.id === 'string' ? body.id.trim() : name;
          if (!body || typeof body !== 'object' || Array.isArray(body) || !validateRoomId(id)) {
            respondJson(response, 400, { error: 'Room name must be 1-32 letters, digits, "_" or "-"' });
            return;
          }
          const existed = roomManager.rooms.has(id);
          const room = await roomManager.getOrCreate(id);
          if (!room) {
            metrics.recordRejection('room_limit');
            logger.warn({ event: 'room.rejected', reason: 'room_limit', roomId: id }, 'Room creation rejected: room limit');
            respondJson(response, 503, { error: 'The server is at its room limit' });
            return;
          }
          if (!existed) {
            logger.info({ event: 'room.created', roomId: room.id }, 'Room created via HTTP API');
          }
          respondJson(response, existed ? 200 : 201, {
            id: room.id,
            name: room.id,
            players: room.players.size,
          });
        } catch (error: unknown) {
          const statusCode = error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number'
            ? error.statusCode
            : 500;
          const message = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
            ? error.message
            : 'Unable to create room';
          respondJson(response, statusCode, {
            error: statusCode !== 500 ? message : 'Unable to create room',
          });
        }
        return;
      }
      response.setHeader('allow', 'GET, POST');
      respondJson(response, 405, { error: 'Method not allowed' });
      return;
    }

    if (url.pathname === '/api/stats') {
      if (request.method !== 'GET') {
        response.setHeader('allow', 'GET');
        respondJson(response, 405, { error: 'Method not allowed' });
        return;
      }
      const snap = metrics.getSnapshot();
      respondJson(response, 200, {
        tickRate: 30,
        stepMs: 1000 / 30,
        version: '1.0.0',
        gitSha: config.gitSha,
        rooms: snap.rooms,
        activeSessions: snap.activeSessions,
        players: snap.players,
        ticks: snap.ticks,
        durationMs: snap.tickDurationMs,
        jitterMs: snap.jitterMs,
        messagesPerSec: snap.messagesPerSec,
        bytesPerSec: snap.bytesPerSec,
        eventLoopUtilization: snap.eventLoopUtilization,
        rejections: snap.rejections,
        uptime: snap.uptime,
        memory: process.memoryUsage(),
      });
      return;
    }

    if (url.pathname === '/api/slow') {
      if (request.method !== 'GET') {
        response.setHeader('allow', 'GET');
        respondJson(response, 405, { error: 'Method not allowed' });
        return;
      }
      const requested = url.searchParams.get('ms') ?? '300';
      if (!/^\d{1,4}$/.test(requested) || Number(requested) > 2000) {
        respondJson(response, 400, { error: 'ms must be an integer from 0 to 2000' });
        return;
      }
      const duration = Number(requested);
      const startedAt = performance.now();
      while (performance.now() - startedAt < duration) {
        // Intentional synchronous blocking for the Event Loop experiment.
      }
      respondJson(response, 200, { blockedMs: Math.round(performance.now() - startedAt) });
      return;
    }

    try {
      if (await handleReplayRequest(request, response, { logDir: config.logDir })) return;
    } catch (error: unknown) {
      logger.error({ event: 'replay.error', err: error }, 'Replay request failed');
      respondJson(response, 500, { error: 'Replay request failed' });
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      respondJson(response, 405, { error: 'Method not allowed' });
      return;
    }
    if (!staticDir) {
      respondJson(response, 404, { error: 'Not found' });
      return;
    }

    let requestedPath: string;
    try {
      requestedPath = decodeURIComponent(url.pathname);
    } catch {
      respondJson(response, 400, { error: 'Invalid path' });
      return;
    }
    if (requestedPath.includes('\0') || requestedPath.includes('..')) {
      respondJson(response, 403, { error: 'Forbidden' });
      return;
    }
    const relativePath = requestedPath === '/' ? 'index.html' : requestedPath.replace(/^[/\\]+/, '');
    const filePath = resolve(staticDir, relativePath);
    if (filePath !== staticDir && !filePath.startsWith(`${staticDir}${sep}`)) {
      respondJson(response, 403, { error: 'Forbidden' });
      return;
    }

    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) {
        respondJson(response, 404, { error: 'Not found' });
        return;
      }
      response.writeHead(200, {
        'content-type': contentTypes.get(extname(filePath).toLowerCase()) ?? 'application/octet-stream',
        'content-length': fileStat.size,
        'x-content-type-options': 'nosniff',
      });
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      await pipeline(createReadStream(filePath), response);
    } catch (error: unknown) {
      const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
        ? error.code
        : undefined;
      if (code === 'ENOENT') {
        if (!extname(requestedPath)) {
          const indexPath = resolve(staticDir, 'index.html');
          try {
            const indexStat = await stat(indexPath);
            response.writeHead(200, {
              'content-type': 'text/html; charset=utf-8',
              'content-length': indexStat.size,
              'x-content-type-options': 'nosniff',
            });
            if (request.method === 'HEAD') {
              response.end();
              return;
            }
            await pipeline(createReadStream(indexPath), response);
            return;
          } catch {
            // Fall through to 404 if index.html is missing
          }
        }
        respondJson(response, 404, { error: 'Not found' });
      } else if (!response.destroyed) {
        logger.error({ event: 'static.error', err: error }, 'Static file request failed');
        if (response.headersSent) response.destroy(error instanceof Error ? error : undefined);
        else respondJson(response, 500, { error: 'Unable to serve file' });
      }
    }
  };
}

export function createGameServer({
  config = loadConfig(),
  staticDir = defaultStaticDirectory,
  logger = createLogger({ level: config.logLevel, gitSha: config.gitSha }),
}: {
  config?: ReturnType<typeof loadConfig>;
  staticDir?: string | null;
  logger?: Logger;
} = {}) {
  if (!config || typeof config !== 'object') throw new TypeError('config must be an object');
  staticDir = staticDir === null ? null : resolve(staticDir);
  let shuttingDown = false;
  let closingPromise: Promise<void> | null = null;

  const isShuttingDown = () => shuttingDown;
  const roomManager = new RoomManager({ maxRooms: config.maxRooms, logDir: config.logDir });
  const metrics = new ServerMetrics({ roomManager });
  const httpServer = http.createServer(
    createHttpHandler({ config, roomManager, staticDir, metrics, logger, isShuttingDown }),
  );
  const wsRuntime = attachWebSocketServer(httpServer, {
    config,
    roomManager,
    logger,
    metrics,
    isShuttingDown,
  });

  httpServer.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });
  httpServer.on('error', (error) => {
    logger.error({ event: 'http.server_error', err: error }, 'HTTP server error');
  });

  async function listen(port = config.port, host = config.host) {
    await mkdir(config.logDir, { recursive: true });
    await new Promise<void>((resolveListen, rejectListen) => {
      const onError = (error: Error) => {
        httpServer.off('listening', onListening);
        rejectListen(error);
      };
      const onListening = () => {
        httpServer.off('error', onError);
        resolveListen();
      };
      httpServer.once('error', onError);
      httpServer.once('listening', onListening);
      httpServer.listen(port, host);
    });
    const addr = httpServer.address();
    logger.info(
      {
        event: 'server.started',
        port: typeof addr === 'object' && addr ? addr.port : port,
        host,
        gitSha: config.gitSha,
        nodeEnv: config.nodeEnv,
      },
      'Dogfight server listening',
    );
    return addr;
  }

  async function close() {
    if (closingPromise) return closingPromise;
    shuttingDown = true;
    closingPromise = (async () => {
      logger.info({ event: 'server.shutdown_initiated' }, 'Initiating graceful shutdown');
      const httpClose = httpServer.listening
        ? new Promise<void>((resolveClose, rejectClose) => {
            httpServer.close((error) => (error ? rejectClose(error) : resolveClose()));
            httpServer.closeIdleConnections?.();
          })
        : Promise.resolve();
      await wsRuntime.close();
      await httpClose;
      logger.info({ event: 'server.shutdown_complete' }, 'Graceful shutdown complete');
      await flushLogger(logger);
    })();
    return closingPromise;
  }

  return Object.freeze({
    server: httpServer,
    httpServer,
    webSocketServer: wsRuntime.webSocketServer,
    rooms: roomManager.rooms,
    metrics,
    logger,
    config,
    isShuttingDown,
    listen,
    close,
  });
}
