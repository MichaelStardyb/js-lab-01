import { describe, it, expect } from 'vitest';
import {
  parseClientMessage,
  asEntityId,
  asTick,
  asSeq,
  JoinMessageSchema,
  ChatClientMessageSchema,
  InputMessageSchema,
  LeaveMessageSchema,
  PingMessageSchema,
} from '../protocol/schema.js';

describe('shared/protocol/schema', () => {
  describe('branded types constructors', () => {
    it('casts number values to nominal branded types', () => {
      const id = asEntityId(42);
      const tick = asTick(100);
      const seq = asSeq(77);
      expect(id).toBe(42);
      expect(tick).toBe(100);
      expect(seq).toBe(77);
    });
  });

  describe('parseClientMessage valid messages', () => {
    it('parses valid join message from object and string', () => {
      const msg = { v: 0, type: 'join', room: 'room_1', name: 'PlayerOne' };
      const resObj = parseClientMessage(msg);
      expect('value' in resObj && resObj.value).toEqual(msg);

      const resStr = parseClientMessage(JSON.stringify(msg));
      expect('value' in resStr && resStr.value).toEqual(msg);
    });

    it('parses valid chat message', () => {
      const msg = { v: 0, type: 'chat', text: 'Hello, world!' };
      const res = parseClientMessage(msg);
      expect('value' in res && res.value).toEqual(msg);
    });

    it('parses valid leave message', () => {
      const msg = { v: 0, type: 'leave' };
      const res = parseClientMessage(msg);
      expect('value' in res && res.value).toEqual(msg);
    });

    it('parses valid input message', () => {
      const msg = {
        v: 1,
        type: 'input',
        seq: 1234,
        thrust: true,
        turnLeft: false,
        turnRight: true,
        fire: false,
      };
      const res = parseClientMessage(msg);
      expect('value' in res && res.value).toEqual(msg);
    });

    it('parses valid ping message', () => {
      const msg = { v: 1, type: 'ping', time: 123456.78 };
      const res = parseClientMessage(msg);
      expect('value' in res && res.value).toEqual(msg);
    });
  });

  describe('parseClientMessage invalid messages and edge cases', () => {
    it('returns error without throwing on malformed JSON string', () => {
      const res = parseClientMessage('{"invalid json: true');
      expect('error' in res).toBe(true);
      if ('error' in res) {
        expect(res.closeCode).toBe(1003);
      }
    });

    it('returns error on primitives or null', () => {
      expect('error' in parseClientMessage(null)).toBe(true);
      expect('error' in parseClientMessage(undefined)).toBe(true);
      expect('error' in parseClientMessage(123)).toBe(true);
      expect('error' in parseClientMessage(true)).toBe(true);
      expect('error' in parseClientMessage([])).toBe(true);
    });

    it('returns error on unknown message type', () => {
      const res = parseClientMessage({ v: 0, type: 'unknown_type' });
      expect('error' in res).toBe(true);
      if ('error' in res) {
        expect(res.closeCode).toBe(1008);
      }
    });

    it('returns error on missing required fields or invalid types', () => {
      // Missing 'name' in join
      const badJoin = parseClientMessage({ v: 0, type: 'join', room: 'room_1' });
      expect('error' in badJoin).toBe(true);

      // Input with string seq
      const badInput = parseClientMessage({
        v: 1,
        type: 'input',
        seq: 'not_a_number',
        thrust: true,
        turnLeft: false,
        turnRight: false,
        fire: false,
      });
      expect('error' in badInput).toBe(true);
    });

    it('rejects illegal characters in room name or player name', () => {
      const badRoom = parseClientMessage({ v: 0, type: 'join', room: 'bad room!', name: 'ValidName' });
      expect('error' in badRoom).toBe(true);

      const badName = parseClientMessage({ v: 0, type: 'join', room: 'valid_room', name: 'Name\x00WithNull' });
      expect('error' in badName).toBe(true);
    });
  });
});
