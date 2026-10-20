import { decodeSnapshot } from 'shared/protocol/binaryCodec.js';

self.addEventListener('message', (event: MessageEvent<{ buffer: ArrayBuffer }>) => {
  try {
    const buffer = event.data.buffer;
    const snapshot = decodeSnapshot(buffer);
    self.postMessage({ success: true, snapshot });
  } catch (error) {
    self.postMessage({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
