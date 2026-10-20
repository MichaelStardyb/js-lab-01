import { EventEmitter } from 'node:events';
import { RoomLog } from './log/matchlog.js';
import type { RoomGame } from './game.js';

export type Player = {
  id: string;
  name: string;
};

export type RoomChatEvent = {
  type: 'chat';
  room: string;
  player: { id: string; name: string };
  text: string;
  timestamp: string;
};

export type RoomJoinLeaveEvent = {
  type: 'join' | 'leave';
  room: string;
  player: { id: string; name: string };
  timestamp: string;
};

export type RoomEventData = RoomChatEvent | RoomJoinLeaveEvent;

export interface RoomEvents {
  join: (player: Player) => void;
  leave: (player: Player) => void;
  chat: (event: RoomChatEvent) => void;
  event: (event: RoomEventData) => void;
  empty: () => void;
  logBackpressure: () => void;
  logDrain: () => void;
}

export class Room extends EventEmitter {
  id: string;
  players: Map<object, Player>;
  log!: RoomLog;
  gameSession: RoomGame | null = null;
  logFlowControlAttached: boolean = false;

  constructor(id: string) {
    super();
    this.id = id;
    this.players = new Map();
  }

  override emit<E extends keyof RoomEvents>(event: E, ...args: Parameters<RoomEvents[E]>): boolean {
    return super.emit(event, ...args);
  }

  override on<E extends keyof RoomEvents>(event: E, listener: RoomEvents[E]): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  override once<E extends keyof RoomEvents>(event: E, listener: RoomEvents[E]): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }

  override addListener<E extends keyof RoomEvents>(event: E, listener: RoomEvents[E]): this {
    return super.addListener(event, listener as (...args: unknown[]) => void);
  }

  override removeListener<E extends keyof RoomEvents>(event: E, listener: RoomEvents[E]): this {
    return super.removeListener(event, listener as (...args: unknown[]) => void);
  }

  override off<E extends keyof RoomEvents>(event: E, listener: RoomEvents[E]): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }

  add(socket: object, player: Player): void {
    this.players.set(socket, player);
    const event: RoomJoinLeaveEvent = {
      type: 'join',
      room: this.id,
      player: { id: player.id, name: player.name },
      timestamp: new Date().toISOString(),
    };
    this.emit('join', player);
    this.emit('event', event);
  }

  remove(socket: object): Player | null {
    const player = this.players.get(socket);
    if (!player) return null;
    this.players.delete(socket);
    const event: RoomJoinLeaveEvent = {
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

  recordChat(player: Player, text: string): RoomChatEvent {
    const event: RoomChatEvent = {
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

  roster(): Array<{ id: string; name: string }> {
    return [...this.players.values()].map(({ id, name }) => ({ id, name }));
  }
}

export class RoomManager {
  maxRooms: number;
  logDir: string;
  rooms: Map<string, Room>;
  closingLogs: Map<string, Promise<void>>;

  constructor({ maxRooms, logDir }: { maxRooms: number; logDir: string }) {
    this.maxRooms = maxRooms;
    this.logDir = logDir;
    this.rooms = new Map();
    this.closingLogs = new Map();
  }

  async getOrCreate(roomId: string): Promise<Room | null> {
    const closingLog = this.closingLogs.get(roomId);
    if (closingLog) await closingLog;
    const existing = this.rooms.get(roomId);
    if (existing) return existing;
    if (this.rooms.size >= this.maxRooms) return null;

    const room = new Room(roomId);
    const log = new RoomLog(RoomLog.filePath(this.logDir, roomId));
    log.on('error', (error: unknown) => console.error(`Room log ${roomId} failed:`, error));
    room.on('event', (event: RoomEventData) => log.write(event));
    log.on('backpressure', () => room.emit('logBackpressure'));
    log.on('drain', () => room.emit('logDrain'));
    room.log = log;
    room.on('empty', () => this.removeEmpty(room));
    this.rooms.set(roomId, room);
    return room;
  }

  removeEmpty(room: Room): void {
    if (room.players.size !== 0 || this.rooms.get(room.id) !== room) return;
    this.rooms.delete(room.id);
    room.removeAllListeners('event');
    const closing: Promise<void> = room.log.close()
      .catch((error: unknown) => console.error(`Room log ${room.id} close failed:`, error))
      .finally(() => {
        room.removeAllListeners();
        if (this.closingLogs.get(room.id) === closing) this.closingLogs.delete(room.id);
      });
    this.closingLogs.set(room.id, closing);
  }

  async close(): Promise<void> {
    const pending: Promise<void>[] = [...this.closingLogs.values()];
    for (const room of this.rooms.values()) {
      room.gameSession?.close();
      room.removeAllListeners('event');
      pending.push(room.log.close());
    }
    this.rooms.clear();
    await Promise.all(pending);
  }
}
