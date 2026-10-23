import { pathToFileURL } from 'node:url';
import { createGameServer } from './app.js';
import { loadConfig } from './config.js';
import { createLogger, flushLogger } from './logger.js';

export { createGameServer } from './app.js';
export { loadConfig } from './config.js';
export { createLogger, flushLogger } from './logger.js';
export { ServerMetrics } from './metrics.js';
export { Room, RoomManager } from './rooms.js';
export { RoomLog, NdjsonTransform } from './log/matchlog.js';
export { handleReplayRequest } from './log/replay.js';
export { TokenBucket, validateClientMessage, validateRoomId } from './protocol.js';
export { attachWebSocketServer, isOriginAllowed, extractClientIp } from './ws.js';

export function registerProcessHandlers({
  runtime,
  logger,
  shutdownTimeoutMs = 8000,
  exit = (code: number) => process.exit(code),
}: {
  runtime: ReturnType<typeof createGameServer>;
  logger: ReturnType<typeof createLogger>;
  shutdownTimeoutMs?: number;
  exit?: (code: number) => void;
}) {
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ event: 'process.signal', signal }, `Received ${signal}; shutting down gracefully`);
    const forceTimer = setTimeout(() => {
      logger.error({ event: 'process.shutdown_timeout', signal }, 'Shutdown timed out; forcing exit');
      exit(1);
    }, shutdownTimeoutMs);
    forceTimer.unref?.();

    try {
      await runtime.close();
      clearTimeout(forceTimer);
      exit(0);
    } catch (error: unknown) {
      clearTimeout(forceTimer);
      logger.fatal({ event: 'process.shutdown_failed', err: error }, 'Graceful shutdown failed');
      await flushLogger(logger);
      exit(1);
    }
  };

  const onFatalError = async (type: 'uncaughtException' | 'unhandledRejection', error: unknown) => {
    logger.fatal(
      {
        event: `process.${type}`,
        err: error instanceof Error ? { message: error.message, stack: error.stack, name: error.name } : String(error),
      },
      `Fatal ${type} — crashing process for clean supervisor restart`,
    );
    try {
      await Promise.race([
        runtime.close(),
        new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 1500)),
      ]);
      await flushLogger(logger);
    } catch {
      // Ignore secondary close errors during fatal crash
    }
    exit(1);
  };

  const sigintHandler = () => void shutdown('SIGINT');
  const sigtermHandler = () => void shutdown('SIGTERM');
  const uncaughtHandler = (err: Error) => void onFatalError('uncaughtException', err);
  const rejectionHandler = (reason: unknown) => void onFatalError('unhandledRejection', reason);

  process.once('SIGINT', sigintHandler);
  process.once('SIGTERM', sigtermHandler);
  process.once('uncaughtException', uncaughtHandler);
  process.once('unhandledRejection', rejectionHandler);

  return {
    shutdown,
    onFatalError,
    unregister() {
      process.off('SIGINT', sigintHandler);
      process.off('SIGTERM', sigtermHandler);
      process.off('uncaughtException', uncaughtHandler);
      process.off('unhandledRejection', rejectionHandler);
    },
  };
}

async function start() {
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel, gitSha: config.gitSha });
  const runtime = createGameServer({ config, logger });
  registerProcessHandlers({ runtime, logger, shutdownTimeoutMs: config.shutdownTimeoutMs });
  await runtime.listen();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch((error: unknown) => {
    const fallbackLogger = createLogger();
    fallbackLogger.fatal(
      { event: 'server.startup_failed', err: error instanceof Error ? { message: error.message, stack: error.stack } : String(error) },
      'Unable to start Dogfight server',
    );
    void flushLogger(fallbackLogger).finally(() => {
      process.exit(1);
    });
  });
}
