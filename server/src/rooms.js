import { EventEmitter } from 'node:events';
import { RoomLog } from './log/matchlog.js';

export class Room extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    this.players = new Map();
  }

  add(socket, player) {
    this.players.set(socket, player);
    const event = {
      type: 'join',
      room: this.id,
      player: { id: player.id, name: player.name },
      timestamp: new Date().toISOString(),
    };
    this.emit('join', player);
    this.emit('event', event);
  }

  remove(socket) {
    const player = this.players.get(socket);
    if (!player) return null;
    this.players.delete(socket);
    const event = {
      type: 'leave',
      room: this.id,
      player: { id: player.id, name: player.name },
      timestamp: new Date().toISOString(),
    };
    this.emit('leave', player);
    this.emit('event', event);
    if (this.players.size === 0) this.emit('empty');
    return player;
  }

  recordChat(player, text) {
    const event = {
      type: 'chat',
      room: this.id,
      player: { id: player.id, name: player.name },
      text,
      timestamp: new Date().toISOString(),
    };
    this.emit('chat', event);
    this.emit('event', event);
    return event;
  }

  roster() {
    return [...this.players.values()].map(({ id, name }) => ({ id, name }));
  }
}

export class RoomManager {
  constructor({ maxRooms, logDir }) {
    this.maxRooms = maxRooms;
    this.logDir = logDir;
    this.rooms = new Map();
    this.closingLogs = new Map();
  }

  async getOrCreate(roomId) {
    const closingLog = this.closingLogs.get(roomId);
    if (closingLog) await closingLog;
    const existing = this.rooms.get(roomId);
    if (existing) return existing;
    if (this.rooms.size >= this.maxRooms) return null;

    const room = new Room(roomId);
    const log = new RoomLog(RoomLog.filePath(this.logDir, roomId));
    log.on('error', (error) => console.error(`Room log ${roomId} failed:`, error));
    room.on('event', (event) => log.write(event));
    log.on('backpressure', () => room.emit('logBackpressure'));
    log.on('drain', () => room.emit('logDrain'));
    room.log = log;
    room.on('empty', () => this.removeEmpty(room));
    this.rooms.set(roomId, room);
    return room;
  }

  removeEmpty(room) {
    if (room.players.size !== 0 || this.rooms.get(room.id) !== room) return;
    this.rooms.delete(room.id);
    room.removeAllListeners('event');
    const closing = room.log.close()
      .catch((error) => console.error(`Room log ${room.id} close failed:`, error))
      .finally(() => {
        room.removeAllListeners();
        if (this.closingLogs.get(room.id) === closing) this.closingLogs.delete(room.id);
      });
    this.closingLogs.set(room.id, closing);
  }

  async close() {
    const pending = [...this.closingLogs.values()];
    for (const room of this.rooms.values()) {
      room.gameSession?.close();
      room.removeAllListeners('event');
      pending.push(room.log.close());
    }
    this.rooms.clear();
    await Promise.all(pending);
  }
}
