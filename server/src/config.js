import { dirname, isAbsolute, resolve } from 'node:path';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';

const serverDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(serverDirectory, '..', '..');

const defaults = Object.freeze({
  PORT: 3000,
  HOST: '127.0.0.1',
  LOG_DIR: './logs',
  MAX_ROOMS: 50,
  MAX_PLAYERS_PER_ROOM: 8,
  MAX_PAYLOAD_BYTES: 4096,
  RATE_LIMIT_PER_SEC: 15,
  INPUT_RATE_LIMIT_PER_SEC: 90,
  MAX_BUFFERED_AMOUNT: 65536,
  JOIN_TIMEOUT_MS: 5000,
  HEARTBEAT_INTERVAL_MS: 15000,
});
const hostnamePattern = /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?))*$/;

function positiveInteger(name, value, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return parsed;
}

export function loadConfig(env = process.env) {
  const port = env.PORT === undefined ? defaults.PORT : positiveInteger('PORT', env.PORT, 1, 65535);
  const host = env.HOST === undefined ? defaults.HOST : String(env.HOST).trim();
  const logDirectoryValue = env.LOG_DIR === undefined ? defaults.LOG_DIR : String(env.LOG_DIR).trim();

  if (!host || (isIP(host) === 0 && !hostnamePattern.test(host))) {
    throw new Error('HOST must be a non-empty hostname or IP address without whitespace');
  }
  if (!logDirectoryValue || logDirectoryValue.includes('\0')) {
    throw new Error('LOG_DIR must be a non-empty path without null characters');
  }

  return Object.freeze({
    port,
    host,
    logDir: isAbsolute(logDirectoryValue)
      ? logDirectoryValue
      : resolve(projectDirectory, logDirectoryValue),
    maxRooms: env.MAX_ROOMS === undefined
      ? defaults.MAX_ROOMS
      : positiveInteger('MAX_ROOMS', env.MAX_ROOMS, 1, 10000),
    maxPlayersPerRoom: env.MAX_PLAYERS_PER_ROOM === undefined
      ? defaults.MAX_PLAYERS_PER_ROOM
      : positiveInteger('MAX_PLAYERS_PER_ROOM', env.MAX_PLAYERS_PER_ROOM, 1, 1000),
    maxPayloadBytes: env.MAX_PAYLOAD_BYTES === undefined
      ? defaults.MAX_PAYLOAD_BYTES
      : positiveInteger('MAX_PAYLOAD_BYTES', env.MAX_PAYLOAD_BYTES, 128, 1024 * 1024),
    rateLimitPerSec: env.RATE_LIMIT_PER_SEC === undefined
      ? defaults.RATE_LIMIT_PER_SEC
      : positiveInteger('RATE_LIMIT_PER_SEC', env.RATE_LIMIT_PER_SEC, 1, 10000),
    inputRateLimitPerSec: env.INPUT_RATE_LIMIT_PER_SEC === undefined
      ? defaults.INPUT_RATE_LIMIT_PER_SEC
      : positiveInteger('INPUT_RATE_LIMIT_PER_SEC', env.INPUT_RATE_LIMIT_PER_SEC, 30, 10000),
    maxBufferedAmount: env.MAX_BUFFERED_AMOUNT === undefined
      ? defaults.MAX_BUFFERED_AMOUNT
      : positiveInteger('MAX_BUFFERED_AMOUNT', env.MAX_BUFFERED_AMOUNT, 1024, 1024 * 1024 * 1024),
    joinTimeoutMs: env.JOIN_TIMEOUT_MS === undefined
      ? defaults.JOIN_TIMEOUT_MS
      : positiveInteger('JOIN_TIMEOUT_MS', env.JOIN_TIMEOUT_MS, 100, 10 * 60 * 1000),
    heartbeatIntervalMs: env.HEARTBEAT_INTERVAL_MS === undefined
      ? defaults.HEARTBEAT_INTERVAL_MS
      : positiveInteger('HEARTBEAT_INTERVAL_MS', env.HEARTBEAT_INTERVAL_MS, 1000, 10 * 60 * 1000),
  });
}

export { defaults as defaultConfig };
