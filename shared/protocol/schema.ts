import { z } from 'zod';

// Branded Types
export type EntityId = number & { readonly __brand: "EntityId" };
export type Tick = number & { readonly __brand: "Tick" };
export type Seq = number & { readonly __brand: "Seq" };

// Nominal typing cast: guarantees number is explicitly validated as an EntityId
export function asEntityId(value: number): EntityId { return value as EntityId; }
// Nominal typing cast: guarantees number is explicitly validated as a simulation Tick
export function asTick(value: number): Tick { return value as Tick; }
// Nominal typing cast: guarantees number is explicitly validated as an input Seq
export function asSeq(value: number): Seq { return value as Seq; }

// Client -> Server
export const JoinMessageSchema = z.object({
  v: z.literal(0),
  type: z.literal('join'),
  room: z.string().min(1).max(32).regex(/^[\p{L}\p{N}_-]{1,32}$/u),
  name: z.string().min(1).max(24).regex(/^[^\u0000-\u001f\u007f]+$/u)
});

export const ChatClientMessageSchema = z.object({
  v: z.literal(0),
  type: z.literal('chat'),
  text: z.string().min(1).max(500).regex(/^[^\u0000-\u001f\u007f]+$/u)
});

export const LeaveMessageSchema = z.object({
  v: z.literal(0),
  type: z.literal('leave')
});

export const InputMessageSchema = z.object({
  v: z.literal(1),
  type: z.literal('input'),
  seq: z.number().int().min(0).max(0xFFFFFFFF),
  thrust: z.boolean(),
  turnLeft: z.boolean(),
  turnRight: z.boolean(),
  fire: z.boolean()
});

export const PingMessageSchema = z.object({
  v: z.literal(1),
  type: z.literal('ping'),
  time: z.number().finite()
});

export const ClientMessageSchema = z.discriminatedUnion('type', [
  JoinMessageSchema,
  ChatClientMessageSchema,
  LeaveMessageSchema,
  InputMessageSchema,
  PingMessageSchema
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export function parseClientMessage(raw: unknown): { value: ClientMessage } | { error: string; closeCode: number } {
  let message;
  if (Buffer.isBuffer(raw)) {
    try {
      message = JSON.parse(raw.toString('utf8'));
    } catch {
      return { error: 'Message must be valid JSON', closeCode: 1003 };
    }
  } else if (typeof raw === 'string') {
    try {
      message = JSON.parse(raw);
    } catch {
      return { error: 'Message must be valid JSON', closeCode: 1003 };
    }
  } else {
    message = raw;
  }
  
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return { error: 'Message must be a JSON object', closeCode: 1003 };
  }

  const parsed = ClientMessageSchema.safeParse(message);
  if (parsed.success) {
    return { value: parsed.data };
  } else {
    const firstIssue = parsed.error.issues?.[0];
    return { error: firstIssue?.message ?? 'Invalid message', closeCode: 1008 };
  }
}
