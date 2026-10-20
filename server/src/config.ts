import { dirname, isAbsolute, resolve } from 'node:path';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

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

export const ConfigEnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(defaults.PORT),
  HOST: z.string().trim().min(1).refine(
    (h) => isIP(h) !== 0 || hostnamePattern.test(h),
    { message: 'HOST must be a non-empty hostname or IP address without whitespace' }
  ).default(defaults.HOST),
  LOG_DIR: z.string().trim().min(1).refine(
    (dir) => !dir.includes('\0'),
    { message: 'LOG_DIR must be a non-empty path without null characters' }
  ).default(defaults.LOG_DIR),
  MAX_ROOMS: z.coerce.number().int().min(1).max(10000).default(defaults.MAX_ROOMS),
  MAX_PLAYERS_PER_ROOM: z.coerce.number().int().min(1).max(1000).default(defaults.MAX_PLAYERS_PER_ROOM),
  MAX_PAYLOAD_BYTES: z.coerce.number().int().min(128).max(1024 * 1024).default(defaults.MAX_PAYLOAD_BYTES),
  RATE_LIMIT_PER_SEC: z.coerce.number().int().min(1).max(10000).default(defaults.RATE_LIMIT_PER_SEC),
  INPUT_RATE_LIMIT_PER_SEC: z.coerce.number().int().min(30).max(10000).default(defaults.INPUT_RATE_LIMIT_PER_SEC),
  MAX_BUFFERED_AMOUNT: z.coerce.number().int().min(1024).max(1024 * 1024 * 1024).default(defaults.MAX_BUFFERED_AMOUNT),
  JOIN_TIMEOUT_MS: z.coerce.number().int().min(100).max(10 * 60 * 1000).default(defaults.JOIN_TIMEOUT_MS),
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(1000).max(10 * 60 * 1000).default(defaults.HEARTBEAT_INTERVAL_MS),
});

export function loadConfig(env: Record<string, string | undefined> = process.env) {
  const parsed = ConfigEnvSchema.parse(env);

  return Object.freeze({
    port: parsed.PORT,
    host: parsed.HOST,
    logDir: isAbsolute(parsed.LOG_DIR)
      ? parsed.LOG_DIR
      : resolve(projectDirectory, parsed.LOG_DIR),
    maxRooms: parsed.MAX_ROOMS,
    maxPlayersPerRoom: parsed.MAX_PLAYERS_PER_ROOM,
    maxPayloadBytes: parsed.MAX_PAYLOAD_BYTES,
    rateLimitPerSec: parsed.RATE_LIMIT_PER_SEC,
    inputRateLimitPerSec: parsed.INPUT_RATE_LIMIT_PER_SEC,
    maxBufferedAmount: parsed.MAX_BUFFERED_AMOUNT,
    joinTimeoutMs: parsed.JOIN_TIMEOUT_MS,
    heartbeatIntervalMs: parsed.HEARTBEAT_INTERVAL_MS,
  });
}

export type ServerConfig = ReturnType<typeof loadConfig>;
export const defaultConfig = defaults;
