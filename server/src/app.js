import { createReadStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { pipeline } from 'node:stream/promises';
import { loadConfig } from './config.js';
import { handleReplayRequest } from './log/replay.js';
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
  ['.mp3', 'audio/mpeg'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
]);

function respondJson(response, statusCode, body) {
  if (response.headersSent || response.destroyed) return;
  const content = JSON.stringify(body);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(content),
    'cache-control': 'no-store',
  });
  response.end(content);
}

function readJsonBody(request, maxBytes) {
  return new Promise((resolveBody, rejectBody) => {
    let body = '';
    let settled = false;
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
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
    request.on('error', (error) => {
      if (!settled) rejectBody(error);
    });
  });
}

function createHttpHandler({ config, roomManager, staticDir }) {
  return async function handleRequest(request, response) {
    const rawPath = (request.url ?? '').split('?', 1)[0];
    let decodedRawPath;
    try {
      decodedRawPath = decodeURIComponent(rawPath);
    } catch {
      respondJson(response, 400, { error: 'Invalid path' });
      return;
    }
    if (decodedRawPath.includes('..')) {
      respondJson(response, 403, { error: 'Forbidden' });
      return;
    }

    let url;
    try {
      url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
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
      respondJson(response, 200, { status: 'ok', uptime: process.uptime() });
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
        try {
          const body = await readJsonBody(request, 1024);
          const name = typeof body?.name === 'string' ? body.name.trim() : '';
          const id = typeof body?.id === 'string' ? body.id.trim() : name;
          if (!body || typeof body !== 'object' || Array.isArray(body) || !validateRoomId(id)) {
            respondJson(response, 400, { error: 'Room name must be 1-32 letters, digits, "_" or "-"' });
            return;
          }
          const existed = roomManager.rooms.has(id);
          const room = await roomManager.getOrCreate(id);
          if (!room) {
            respondJson(response, 503, { error: 'The server is at its room limit' });
            return;
          }
          respondJson(response, existed ? 200 : 201, {
            id: room.id,
            name: room.id,
            players: room.players.size,
          });
        } catch (error) {
          respondJson(response, error.statusCode ?? 500, {
            error: error.statusCode ? error.message : 'Unable to create room',
          });
        }
        return;
      }
      response.setHeader('allow', 'GET, POST');
      respondJson(response, 405, { error: 'Method not allowed' });
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
    } catch (error) {
      console.error('Replay request failed:', error);
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

    let requestedPath;
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
    } catch (error) {
      if (error.code === 'ENOENT') {
        respondJson(response, 404, { error: 'Not found' });
      } else if (!response.destroyed) {
        console.error('Static file request failed:', error);
        if (response.headersSent) response.destroy(error);
        else respondJson(response, 500, { error: 'Unable to serve file' });
      }
    }
  };
}

export function createGameServer({ config = loadConfig(), staticDir = defaultStaticDirectory } = {}) {
  if (!config || typeof config !== 'object') throw new TypeError('config must be an object');
  staticDir = staticDir === null ? null : resolve(staticDir);
  const roomManager = new RoomManager({ maxRooms: config.maxRooms, logDir: config.logDir });
  const httpServer = createHttpServer(createHttpHandler({ config, roomManager, staticDir }));
  const wsRuntime = attachWebSocketServer(httpServer, { config, roomManager });

  httpServer.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });
  httpServer.on('error', (error) => console.error('HTTP server error:', error));

  async function listen(port = config.port, host = config.host) {
    await mkdir(config.logDir, { recursive: true });
    await new Promise((resolveListen, rejectListen) => {
      const onError = (error) => {
        httpServer.off('listening', onListening);
        rejectListen(error);
      };
      const onListening = () => {
        httpServer.off('error', onError);
        resolveListen(httpServer.address());
      };
      httpServer.once('error', onError);
      httpServer.once('listening', onListening);
      httpServer.listen(port, host);
    });
    return httpServer.address();
  }

  async function close() {
    const httpClose = httpServer.listening
      ? new Promise((resolveClose, rejectClose) => {
        httpServer.close((error) => error ? rejectClose(error) : resolveClose());
      })
      : Promise.resolve();
    await wsRuntime.close();
    await httpClose;
  }

  return Object.freeze({
    server: httpServer,
    httpServer,
    webSocketServer: wsRuntime.webSocketServer,
    rooms: roomManager.rooms,
    config,
    listen,
    close,
  });
}
