import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';

export type LogContext = {
  roomId?: string;
  playerId?: string;
  event?: string;
  reason?: string;
  ip?: string;
  origin?: string;
  code?: number;
  [key: string]: unknown;
};

const REDACT_PATHS = [
  'password',
  'secret',
  'token',
  'apiKey',
  'key',
  'authorization',
  'cookie',
  '*.password',
  '*.secret',
  '*.token',
  '*.apiKey',
  '*.key',
  'req.headers.authorization',
  'req.headers.cookie',
];

export function createLogger(
  {
    level = process.env.LOG_LEVEL ?? 'info',
    gitSha,
    destination,
  }: {
    level?: string;
    gitSha?: string;
    destination?: DestinationStream;
  } = {},
): Logger {
  const validLevels = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);
  const normalizedLevel = validLevels.has(level) ? level : 'info';

  const options: LoggerOptions = {
    level: normalizedLevel,
    base: gitSha ? { service: 'dogfight-server', gitSha } : { service: 'dogfight-server' },
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  };

  return destination ? pino(options, destination) : pino(options);
}

export async function flushLogger(logger: Logger): Promise<void> {
  await new Promise<void>((resolveFlush) => {
    logger.flush(() => resolveFlush());
  });
}
