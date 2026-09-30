const roomPattern = /^[\p{L}\p{N}_-]{1,32}$/u;
const forbiddenControlCharacters = /[\u0000-\u001f\u007f]/u;

export function validateRoomId(value) {
  return typeof value === 'string' && roomPattern.test(value) ? value : null;
}

export function validateClientMessage(data, maxPayloadBytes, isBinary = false) {
  if (isBinary) return { error: 'Only text messages are supported', closeCode: 1003 };

  const raw = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (raw.byteLength > maxPayloadBytes) return { error: 'Message is too large', closeCode: 1009 };

  let message;
  try {
    message = JSON.parse(raw.toString('utf8'));
  } catch {
    return { error: 'Message must be valid JSON', closeCode: 1003 };
  }

  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return { error: 'Message must be a JSON object', closeCode: 1003 };
  }
  if (message.v !== 0) return { error: 'Unsupported protocol version', closeCode: 1008 };

  switch (message.type) {
    case 'join': {
      if (Object.keys(message).some((key) => !['v', 'type', 'room', 'name'].includes(key))) {
        return { error: 'Unexpected join fields', closeCode: 1008 };
      }
      const room = typeof message.room === 'string' ? message.room.trim() : '';
      const name = typeof message.name === 'string' ? message.name.trim() : '';
      if (!validateRoomId(room)) return { error: 'Room must be 1-32 letters, digits, "_" or "-"', closeCode: 1008 };
      if (name.length < 1 || name.length > 24 || forbiddenControlCharacters.test(name)) {
        return { error: 'Name must be 1-24 characters without control characters', closeCode: 1008 };
      }
      return { value: { type: 'join', room, name } };
    }
    case 'chat': {
      if (Object.keys(message).some((key) => !['v', 'type', 'text'].includes(key))) {
        return { error: 'Unexpected chat fields', closeCode: 1008 };
      }
      const text = typeof message.text === 'string' ? message.text.trim() : '';
      if (text.length < 1 || text.length > 500 || forbiddenControlCharacters.test(text)) {
        return { error: 'Chat text must be 1-500 characters without control characters', closeCode: 1008 };
      }
      return { value: { type: 'chat', text } };
    }
    case 'leave':
      return Object.keys(message).length === 2
        ? { value: { type: 'leave' } }
        : { error: 'Unexpected leave fields', closeCode: 1008 };
    default:
      return { error: 'Unknown message type', closeCode: 1003 };
  }
}

export class TokenBucket {
  constructor(ratePerSecond, now = Date.now()) {
    this.capacity = ratePerSecond;
    this.tokens = ratePerSecond;
    this.refillPerMs = ratePerSecond / 1000;
    this.updatedAt = now;
  }

  take(now = Date.now()) {
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
