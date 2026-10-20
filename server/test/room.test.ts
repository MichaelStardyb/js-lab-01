import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Room, RoomManager, type Player } from '../src/rooms.js';

describe('server/rooms Room and RoomManager', () => {
  it('adds players and emits join and event', () => {
    const room = new Room('test-room');
    const socket = {};
    const player: Player = { id: 'p1', name: 'Ace' };

    let joinEmitted = false;
    let eventEmitted = false;
    room.on('join', (p) => {
      if (p.id === 'p1') joinEmitted = true;
    });
    room.on('event', (ev) => {
      if (ev.type === 'join' && ev.player.id === 'p1') eventEmitted = true;
    });

    room.add(socket, player);
    expect(joinEmitted).toBe(true);
    expect(eventEmitted).toBe(true);
    expect(room.players.size).toBe(1);
    expect(room.roster()).toEqual([{ id: 'p1', name: 'Ace' }]);
  });

  it('records chat messages and emits chat events', () => {
    const room = new Room('test-room');
    const player: Player = { id: 'p1', name: 'Ace' };
    let chatText = '';
    room.on('chat', (ev) => {
      chatText = ev.text;
    });

    const event = room.recordChat(player, 'Incoming asteroid!');
    expect(chatText).toBe('Incoming asteroid!');
    expect(event.player.name).toBe('Ace');
  });

  it('removes players and emits empty when last player leaves', () => {
    const room = new Room('test-room');
    const socket = {};
    const player: Player = { id: 'p1', name: 'Ace' };
    room.add(socket, player);

    let emptyEmitted = false;
    room.on('empty', () => {
      emptyEmitted = true;
    });

    const removed = room.remove(socket);
    expect(removed).toEqual(player);
    expect(room.players.size).toBe(0);
    expect(emptyEmitted).toBe(true);
  });

  it('RoomManager creates, retrieves, and lists rooms', async () => {
    const logDir = await mkdtemp(join(tmpdir(), 'dogfight-rooms-'));
    try {
      const manager = new RoomManager({ maxRooms: 10, logDir });
      const room1 = await manager.getOrCreate('alpha');
      expect(room1).not.toBeNull();
      expect(room1?.id).toBe('alpha');

      const sameRoom = await manager.getOrCreate('alpha');
      expect(sameRoom).toBe(room1);

      room1?.add({}, { id: 'p1', name: 'Pilot' });
      expect(manager.rooms.has('alpha')).toBe(true);
      expect(manager.rooms.get('alpha')?.players.size).toBe(1);
      await manager.close();
    } finally {
      await rm(logDir, { recursive: true, force: true });
    }
  });

  it('RoomManager returns null when maxRooms limit is reached', async () => {
    const logDir = await mkdtemp(join(tmpdir(), 'dogfight-rooms-'));
    try {
      const manager = new RoomManager({ maxRooms: 1, logDir });
      const first = await manager.getOrCreate('first');
      expect(first).not.toBeNull();
      const second = await manager.getOrCreate('second');
      expect(second).toBeNull();
      await manager.close();
    } finally {
      await rm(logDir, { recursive: true, force: true });
    }
  });
});
