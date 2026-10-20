export const PROTOCOL_VERSION = 1;
export const INPUT_MESSAGE_TYPE = 1;
export const SNAPSHOT_MESSAGE_TYPE = 2;
export const INPUT_PACKET_BYTES = 7;
export const SNAPSHOT_HEADER_BYTES = 12;
export const SNAPSHOT_ENTITY_BYTES = 18;

function asUint8Array(buffer: unknown): Uint8Array {
  if (buffer instanceof ArrayBuffer) return new Uint8Array(buffer);
  if (ArrayBuffer.isView(buffer)) return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  throw new TypeError('packet must be an ArrayBuffer or typed-array view');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function validateUint(value: unknown, max: number, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) {
    throw new RangeError(`${name} must be an integer from 0 to ${max}`);
  }
}

function encodeAngle(angle: number): number {
  const principal = ((angle + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return clamp(Math.round(principal * 10000), -32768, 32767);
}

import { InputMessageSchema, type EntityId, type Tick, type Seq, asEntityId, asTick, asSeq } from './schema.js';
import type { z } from 'zod';

export function encodeInput(input: z.infer<typeof InputMessageSchema>): ArrayBuffer {
  validateUint(input.seq, 0xFFFFFFFF, 'seq');
  if (
    typeof input.thrust !== 'boolean' ||
    typeof input.turnLeft !== 'boolean' ||
    typeof input.turnRight !== 'boolean' ||
    typeof input.fire !== 'boolean'
  ) {
    throw new TypeError('input flags must be booleans');
  }
  const flags = (input.thrust ? 1 : 0)
    | (input.turnLeft ? 2 : 0)
    | (input.turnRight ? 4 : 0)
    | (input.fire ? 8 : 0);
  const buffer = new ArrayBuffer(INPUT_PACKET_BYTES);
  const view = new DataView(buffer);
  view.setUint8(0, PROTOCOL_VERSION);
  view.setUint8(1, INPUT_MESSAGE_TYPE);
  view.setUint32(2, input.seq, true);
  view.setUint8(6, flags);
  return buffer;
}

export function decodeInput(packet: unknown): { type: 'input'; seq: Seq; thrust: boolean; turnLeft: boolean; turnRight: boolean; fire: boolean } {
  const bytes = asUint8Array(packet);
  if (bytes.byteLength !== INPUT_PACKET_BYTES) throw new RangeError('input packet must be 7 bytes');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(0) !== PROTOCOL_VERSION || view.getUint8(1) !== INPUT_MESSAGE_TYPE) {
    throw new Error('unsupported input packet version or message type');
  }
  const flags = view.getUint8(6);
  if (flags & 0xF0) throw new Error('input packet contains unknown flags');
  return {
    type: 'input',
    seq: asSeq(view.getUint32(2, true)),
    thrust: Boolean(flags & 1),
    turnLeft: Boolean(flags & 2),
    turnRight: Boolean(flags & 4),
    fire: Boolean(flags & 8),
  };
}

export const SHIP_KIND = 1 as const;
export const BULLET_KIND = 2 as const;
export const ASTEROID_KIND = 3 as const;
export const PICKUP_KIND = 4 as const;

export type ShipSnapshotEntity = {
  readonly id: EntityId;
  readonly kind: typeof SHIP_KIND;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly vx: number;
  readonly vy: number;
  readonly hp?: number;
};

export type BulletSnapshotEntity = {
  readonly id: EntityId;
  readonly kind: typeof BULLET_KIND;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly vx: number;
  readonly vy: number;
  readonly hp?: number;
};

export type AsteroidSnapshotEntity = {
  readonly id: EntityId;
  readonly kind: typeof ASTEROID_KIND;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly vx: number;
  readonly vy: number;
  readonly hp?: number;
};

export type PickupSnapshotEntity = {
  readonly id: EntityId;
  readonly kind: typeof PICKUP_KIND;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly vx: number;
  readonly vy: number;
  readonly hp?: number;
};

export type SnapshotEntity =
  | ShipSnapshotEntity
  | BulletSnapshotEntity
  | AsteroidSnapshotEntity
  | PickupSnapshotEntity;

export type SnapshotMessage = {
  readonly type: 'snapshot';
  readonly tick: Tick;
  readonly lastProcessedSeq: Seq;
  readonly entities: SnapshotEntity[];
};

export function encodeSnapshot(snapshot: {
  readonly tick: Tick | number;
  readonly lastProcessedSeq: Seq | number;
  readonly entities: readonly (SnapshotEntity | { readonly id: number; readonly kind: number; readonly x: number; readonly y: number; readonly angle: number; readonly vx: number; readonly vy: number; readonly hp?: number })[];
}): ArrayBuffer {
  if (!Array.isArray(snapshot.entities)) throw new TypeError('snapshot.entities must be an array');
  validateUint(snapshot.tick, 0xFFFFFFFF, 'tick');
  validateUint(snapshot.lastProcessedSeq, 0xFFFFFFFF, 'lastProcessedSeq');
  validateUint(snapshot.entities.length, 0xFFFF, 'entity count');
  const buffer = new ArrayBuffer(SNAPSHOT_HEADER_BYTES + snapshot.entities.length * SNAPSHOT_ENTITY_BYTES);
  const view = new DataView(buffer);
  view.setUint8(0, PROTOCOL_VERSION);
  view.setUint8(1, SNAPSHOT_MESSAGE_TYPE);
  view.setUint32(2, snapshot.tick, true);
  view.setUint32(6, snapshot.lastProcessedSeq, true);
  view.setUint16(10, snapshot.entities.length, true);
  let offset = SNAPSHOT_HEADER_BYTES;
  for (const entity of snapshot.entities) {
    validateUint(entity.id, 0xFFFF, 'entity id');
    validateUint(entity.kind, 0xFF, 'entity kind');
    if (
      !Number.isFinite(entity.x) ||
      !Number.isFinite(entity.y) ||
      !Number.isFinite(entity.angle) ||
      !Number.isFinite(entity.vx) ||
      !Number.isFinite(entity.vy)
    ) {
      throw new TypeError('snapshot entity coordinates, angle and velocity must be finite numbers');
    }
    view.setUint16(offset, entity.id, true);
    view.setUint8(offset + 2, entity.kind);
    view.setFloat32(offset + 3, entity.x, true);
    view.setFloat32(offset + 7, entity.y, true);
    view.setInt16(offset + 11, encodeAngle(entity.angle), true);
    view.setInt16(offset + 13, clamp(Math.round(entity.vx), -32768, 32767), true);
    view.setInt16(offset + 15, clamp(Math.round(entity.vy), -32768, 32767), true);
    view.setUint8(offset + 17, clamp(Math.round(entity.hp ?? 100), 0, 255));
    offset += SNAPSHOT_ENTITY_BYTES;
  }
  return buffer;
}

export function decodeSnapshot(packet: unknown): SnapshotMessage {
  const bytes = asUint8Array(packet);
  if (bytes.byteLength < SNAPSHOT_HEADER_BYTES) throw new RangeError('snapshot packet is shorter than its header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(0) !== PROTOCOL_VERSION || view.getUint8(1) !== SNAPSHOT_MESSAGE_TYPE) {
    throw new Error('unsupported snapshot packet version or message type');
  }
  const entityCount = view.getUint16(10, true);
  const expectedBytes = SNAPSHOT_HEADER_BYTES + entityCount * SNAPSHOT_ENTITY_BYTES;
  if (bytes.byteLength !== expectedBytes) throw new RangeError('snapshot packet length does not match entity count');
  const entities: SnapshotEntity[] = [];
  let offset = SNAPSHOT_HEADER_BYTES;
  for (let index = 0; index < entityCount; index += 1) {
    const rawKind = view.getUint8(offset + 2);
    if (rawKind !== SHIP_KIND && rawKind !== BULLET_KIND && rawKind !== ASTEROID_KIND && rawKind !== PICKUP_KIND) {
      throw new Error(`unsupported snapshot entity kind: ${rawKind}`);
    }
    const entity: SnapshotEntity = {
      id: asEntityId(view.getUint16(offset, true)),
      kind: rawKind,
      x: view.getFloat32(offset + 3, true),
      y: view.getFloat32(offset + 7, true),
      vx: view.getInt16(offset + 13, true),
      vy: view.getInt16(offset + 15, true),
      angle: view.getInt16(offset + 11, true) / 10000,
      hp: view.getUint8(offset + 17),
    };
    if (![entity.x, entity.y].every(Number.isFinite)) throw new Error('snapshot contains non-finite coordinates');
    entities.push(entity);
    offset += SNAPSHOT_ENTITY_BYTES;
  }
  return {
    type: 'snapshot',
    tick: asTick(view.getUint32(2, true)),
    lastProcessedSeq: asSeq(view.getUint32(6, true)),
    entities,
  };
}
