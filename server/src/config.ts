import { execSync } from 'node:child_process';
import { dirname, isAbsolute, resolve } from 'node:path';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const serverDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(serverDirectory, '..', '..');

function detectGitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: projectDirectory,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1500,
    }).toString().trim() || 'v1.0.0';
  } catch {
    return 'v1.0.0';
  }
}

const defaultGitSha = detectGitSha();

const defaults = Object.freeze({
  NODE_ENV: 'development',
  PORT: 3000,
  HOST: '0.0.0.0',
  LOG_LEVEL: 'info',
  LOG_DIR: './logs',
  GIT_SHA: defaultGitSha,
  ALLOWED_ORIGINS: '',
  MAX_CONNECTIONS_PER_IP: 20,
  MAX_ROOMS: 50,
  MAX_PLAYERS_PER_ROOM: 8,
  MAX_PAYLOAD_BYTES: 4096,
  RATE_LIMIT_PER_SEC: 15,
  INPUT_RATE_LIMIT_PER_SEC: 90,
  MAX_BUFFERED_AMOUNT: 65536,
  JOIN_TIMEOUT_MS: 5000,
  HEARTBEAT_INTERVAL_MS: 15000,
  SHUTDOWN_TIMEOUT_MS: 8000,
});

const hostnamePattern = /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?))*$/;

function parseAllowedOrigins(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed === '*') return ['*'];
  const items = trimmed.split(',').map((item) => item.trim()).filter(Boolean);
  for (const item of items) {
    if (item === '*') continue;
    let parsed: URL;
    try {
      parsed = new URL(item);
    } catch {
      throw new Error(`Invalid origin in ALLOWED_ORIGINS: "${item}"`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Origin must use http or https protocol: "${item}"`);
    }
  }
  return items.map((item) => (item === '*' ? '*' : new URL(item).origin));
}

export const ConfigEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default(defaults.NODE_ENV),
  PORT: z.coerce.number().int().min(0).max(65535).default(defaults.PORT),
  HOST: z.string().trim().min(1).refine(
    (h) => isIP(h) !== 0 || hostnamePattern.test(h),
    { message: 'HOST must be a non-empty hostname or IP address without whitespace' },
  ).default(defaults.HOST),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default(defaults.LOG_LEVEL),
  LOG_DIR: z.string().trim().min(1).refine(
    (dir) => !dir.includes('\0'),
    { message: 'LOG_DIR must be a non-empty path without null characters' },
  ).default(defaults.LOG_DIR),
  GIT_SHA: z.string().trim().min(1).max(64).default(defaults.GIT_SHA),
  ALLOWED_ORIGINS: z.string().default(defaults.ALLOWED_ORIGINS).refine(
    (val) => {
      try {
        parseAllowedOrigins(val);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'ALLOWED_ORIGINS must be "*" or a comma-separated list of valid http(s) origins' },
  ),
  MAX_CONNECTIONS_PER_IP: z.coerce.number().int().min(1).max(10000).default(defaults.MAX_CONNECTIONS_PER_IP),
  MAX_ROOMS: z.coerce.number().int().min(1).max(10000).default(defaults.MAX_ROOMS),
  MAX_PLAYERS_PER_ROOM: z.coerce.number().int().min(1).max(1000).default(defaults.MAX_PLAYERS_PER_ROOM),
  MAX_PAYLOAD_BYTES: z.coerce.number().int().min(128).max(1024 * 1024).default(defaults.MAX_PAYLOAD_BYTES),
  RATE_LIMIT_PER_SEC: z.coerce.number().int().min(1).max(10000).default(defaults.RATE_LIMIT_PER_SEC),
  INPUT_RATE_LIMIT_PER_SEC: z.coerce.number().int().min(30).max(10000).default(defaults.INPUT_RATE_LIMIT_PER_SEC),
  MAX_BUFFERED_AMOUNT: z.coerce.number().int().min(1024).max(1024 * 1024 * 1024).default(defaults.MAX_BUFFERED_AMOUNT),
  JOIN_TIMEOUT_MS: z.coerce.number().int().min(100).max(10 * 60 * 1000).default(defaults.JOIN_TIMEOUT_MS),
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(100).max(10 * 60 * 1000).default(defaults.HEARTBEAT_INTERVAL_MS),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(500).max(30000).default(defaults.SHUTDOWN_TIMEOUT_MS),
});

export function loadConfig(env: Record<string, string | undefined> = process.env) {
  const effectiveEnv: Record<string, string | undefined> = {
    ...env,
    GIT_SHA: env.GIT_SHA ?? env.COMMIT_SHA ?? env.GITHUB_SHA?.slice(0, 7) ?? defaults.GIT_SHA,
  };
  const parsed = ConfigEnvSchema.parse(effectiveEnv);
  const allowedOrigins = parseAllowedOrigins(parsed.ALLOWED_ORIGINS);

  return Object.freeze({
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    host: parsed.HOST,
    logLevel: parsed.LOG_LEVEL,
    logDir: isAbsolute(parsed.LOG_DIR)
      ? parsed.LOG_DIR
      : resolve(projectDirectory, parsed.LOG_DIR),
    gitSha: parsed.GIT_SHA,
    allowedOrigins,
    maxConnectionsPerIp: parsed.MAX_CONNECTIONS_PER_IP,
    maxRooms: parsed.MAX_ROOMS,
    maxPlayersPerRoom: parsed.MAX_PLAYERS_PER_ROOM,
    maxPayloadBytes: parsed.MAX_PAYLOAD_BYTES,
    rateLimitPerSec: parsed.RATE_LIMIT_PER_SEC,
    inputRateLimitPerSec: parsed.INPUT_RATE_LIMIT_PER_SEC,
    maxBufferedAmount: parsed.MAX_BUFFERED_AMOUNT,
    joinTimeoutMs: parsed.JOIN_TIMEOUT_MS,
    heartbeatIntervalMs: parsed.HEARTBEAT_INTERVAL_MS,
    shutdownTimeoutMs: parsed.SHUTDOWN_TIMEOUT_MS,
  });
}

export type ServerConfig = ReturnType<typeof loadConfig>;
export const defaultConfig = defaults;
