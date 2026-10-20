import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import http from 'node:http';
import { pipeline } from 'node:stream/promises';
import { RoomLog } from './matchlog.js';
import { validateRoomId } from '../protocol.js';

function sendJson(response: http.ServerResponse, statusCode: number, value: unknown): void {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(value));
}

export async function handleReplayRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  { logDir }: { logDir: string },
): Promise<boolean> {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const match = /^\/api\/(?:replays|rooms\/([^/]+)\/replay)(?:\/([^/]+))?$/.exec(url.pathname);
  if (!match) return false;
  if (request.method !== 'GET') {
    response.setHeader('allow', 'GET');
    sendJson(response, 405, { error: 'Method not allowed' });
    return true;
  }

  let roomId: string;
  try {
    roomId = decodeURIComponent(match[2] ?? match[1] ?? '');
  } catch {
    sendJson(response, 400, { error: 'Invalid room id' });
    return true;
  }
  if (!validateRoomId(roomId)) {
    sendJson(response, 400, { error: 'Invalid room id' });
    return true;
  }

  let filePath: string;
  try {
    const prefix = `${encodeURIComponent(roomId)}-`;
    const files = (await readdir(logDir))
      .filter((file) => file.startsWith(prefix) && file.endsWith('.ndjson'))
      .sort((left, right) => right.localeCompare(left));
    filePath = files.length
      ? join(logDir, files[0] ?? '')
      : RoomLog.filePath(logDir, roomId);
    await stat(filePath);
  } catch (e: unknown) {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') {
      sendJson(response, 404, { error: 'Replay not found' });
      return true;
    }
    sendJson(response, 500, { error: 'Unable to read replay' });
    return true;
  }

  response.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  try {
    await pipeline(createReadStream(filePath), response);
  } catch (e: unknown) {
    if (!response.destroyed) response.destroy(e instanceof Error ? e : new Error(String(e)));
  }
  return true;
}
