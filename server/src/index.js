import { pathToFileURL } from 'node:url';
import { createGameServer } from './app.js';

export { createGameServer } from './app.js';
export { loadConfig } from './config.js';
export { Room, RoomManager } from './rooms.js';
export { RoomLog } from './log/matchlog.js';
export { NdjsonTransform } from './log/matchlog.js';
export { handleReplayRequest } from './log/replay.js';
export { TokenBucket, validateClientMessage, validateRoomId } from './protocol.js';
export { attachWebSocketServer } from './ws.js';

async function start() {
  const runtime = createGameServer();
  const address = await runtime.listen();
  console.log(`Dogfight server listening on ${typeof address === 'string' ? address : `${address.address}:${address.port}`}`);

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}; shutting down`);
    try {
      await runtime.close();
      process.exitCode = 0;
    } catch (error) {
      console.error('Server shutdown failed:', error);
      process.exitCode = 1;
    }
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch((error) => {
    console.error('Unable to start server:', error.message);
    process.exitCode = 1;
  });
}
