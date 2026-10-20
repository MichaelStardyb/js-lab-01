import { parseClientMessage, type ClientMessage } from 'shared/protocol/schema.js';
import { decodeInput } from 'shared/protocol/binaryCodec.js';

export function validateRoomId(value: unknown): string | null {
  if (typeof value === 'string' && /^[\p{L}\p{N}_-]{1,32}$/u.test(value)) return value;
  return null;
}

export type ValidatedClientMessage = 
  | { value: ClientMessage | ReturnType<typeof decodeInput>; error?: never; closeCode?: never }
  | { error: string; closeCode: number; value?: never };

export function validateClientMessage(data: unknown, maxPayloadBytes: number, isBinary: boolean = false): ValidatedClientMessage {
  const raw = Buffer.isBuffer(data)
    ? data
    : typeof data === 'string'
    ? Buffer.from(data)
    : data instanceof ArrayBuffer
    ? Buffer.from(data)
    : ArrayBuffer.isView(data)
    ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    : Buffer.from([]);
  if (raw.byteLength > maxPayloadBytes) return { error: 'Message is too large', closeCode: 1009 };

  if (isBinary) {
    try {
      return { value: decodeInput(raw) };
    } catch (e: unknown) {
      return { error: e instanceof Error ? e.message : 'Binary decode error', closeCode: 1003 };
    }
  }

  return parseClientMessage(raw);
}

export class TokenBucket {
  capacity: number;
  tokens: number;
  refillPerMs: number;
  updatedAt: number;

  constructor(ratePerSecond: number, now: number = Date.now()) {
    this.capacity = ratePerSecond;
    this.tokens = ratePerSecond;
    this.refillPerMs = ratePerSecond / 1000;
    this.updatedAt = now;
  }

  take(now: number = Date.now()): boolean {
    this.tokens = Math.min(
      this.capacity,
      this.tokens + Math.max(0, now - this.updatedAt) * this.refillPerMs,
    );
    this.updatedAt = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
