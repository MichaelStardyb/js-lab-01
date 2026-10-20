import { describe, it, expect } from 'vitest';
import { encodeInput } from 'shared/protocol/binaryCodec.js';
import { parseNetworkSettings } from '../src/latency.js';
import { validateClientMessage, validateRoomId, TokenBucket } from '../src/protocol.js';

describe('server/protocol and rate limiting', () => {
  describe('validateClientMessage', () => {
    it('accepts valid JSON input packets', () => {
      const json = Buffer.from(JSON.stringify({
        v: 1, type: 'input', seq: 14, thrust: true, turnLeft: false, turnRight: true, fire: false,
      }));
      const res = validateClientMessage(json, 1000);
      expect('value' in res && res.value && 'seq' in res.value).toBe(true);
      if ('value' in res && res.value && 'seq' in res.value) {
        expect(res.value.seq).toBe(14);
      }
    });

    it('accepts valid binary input packets', () => {
      const bin = Buffer.from(encodeInput({
        v: 1, type: 'input', seq: 15, thrust: false, turnLeft: true, turnRight: false, fire: true,
      }));
      const res = validateClientMessage(bin, 1000, true);
      expect('value' in res && res.value && 'seq' in res.value).toBe(true);
      if ('value' in res && res.value && 'seq' in res.value) {
        expect(res.value.seq).toBe(15);
      }
    });

    it('rejects payloads larger than maxPayloadBytes', () => {
      const large = Buffer.alloc(2048);
      const res = validateClientMessage(large, 1024);
      expect('error' in res).toBe(true);
      if ('error' in res) {
        expect(res.closeCode).toBe(1009);
      }
    });

    it('rejects invalid JSON inputs', () => {
      const res = validateClientMessage(Buffer.from('{"v":1,"type":"input","seq":-1}'), 1000);
      expect('error' in res).toBe(true);
    });
  });

  describe('validateRoomId', () => {
    it('accepts valid alphanumeric room IDs with underscore and hyphen', () => {
      expect(validateRoomId('demo')).toBe('demo');
      expect(validateRoomId('room_123')).toBe('room_123');
      expect(validateRoomId('game-room-4')).toBe('game-room-4');
    });

    it('rejects invalid room IDs', () => {
      expect(validateRoomId('')).toBeNull();
      expect(validateRoomId('room with spaces')).toBeNull();
      expect(validateRoomId('a'.repeat(33))).toBeNull();
      expect(validateRoomId(null)).toBeNull();
      expect(validateRoomId(123)).toBeNull();
    });
  });

  describe('TokenBucket rate limiter', () => {
    it('initializes with capacity equal to ratePerSecond', () => {
      const bucket = new TokenBucket(15, 1000);
      expect(bucket.capacity).toBe(15);
      expect(bucket.tokens).toBe(15);
    });

    it('allows bursts up to capacity and blocks once tokens exhausted', () => {
      const bucket = new TokenBucket(5, 1000);
      for (let i = 0; i < 5; i++) {
        expect(bucket.take(1000)).toBe(true);
      }
      expect(bucket.take(1000)).toBe(false);
    });

    it('refills tokens over time at ratePerSecond', () => {
      const bucket = new TokenBucket(10, 1000);
      for (let i = 0; i < 10; i++) {
        bucket.take(1000);
      }
      expect(bucket.take(1000)).toBe(false);

      // Advance by 500ms -> should refill 5 tokens
      expect(bucket.take(1500)).toBe(true);
      expect(bucket.tokens).toBeCloseTo(4, 1);
    });

    it('does not exceed capacity upon refill', () => {
      const bucket = new TokenBucket(10, 1000);
      bucket.take(1000); // 9 left
      // Advance by 10 seconds
      expect(bucket.take(11000)).toBe(true);
      expect(bucket.tokens).toBe(9); // capped at 10, minus 1 = 9
    });

    it('maintains completely isolated state for separate client buckets', () => {
      const client1 = new TokenBucket(5, 1000);
      const client2 = new TokenBucket(5, 1000);

      for (let i = 0; i < 5; i++) {
        client1.take(1000);
      }
      expect(client1.take(1000)).toBe(false);
      expect(client2.take(1000)).toBe(true);
    });
  });

  describe('parseNetworkSettings', () => {
    it('returns default injector settings when query is empty', () => {
      const settings = parseNetworkSettings(new URLSearchParams());
      expect(settings.codec).toBe('json');
      expect(settings.injector.minLatency).toBe(100);
      expect(settings.injector.jitter).toBe(15);
      expect(settings.injector.dropRate).toBe(0.02);
    });

    it('validates query params and throws on invalid inputs', () => {
      expect(() => parseNetworkSettings(new URLSearchParams('codec=other'))).toThrow(/codec/);
      expect(() => parseNetworkSettings(new URLSearchParams('drop=2'))).toThrow(/dropRate/);
    });
  });
});
