import type { Seq } from 'shared/protocol/schema.js';

type GameEventMap = {
  chat: CustomEvent<{ text: string; player: { name: string } }>;
  join: CustomEvent<{ player: { name: string } }>;
  leave: CustomEvent<{ player: { name: string } }>;
  error: CustomEvent<{ message: string }>;
  input: CustomEvent<{ type: string; seq: Seq; thrust: boolean; turnLeft: boolean; turnRight: boolean; fire: boolean }>;
};

class TypedEventTarget extends EventTarget {
  addEventListener<K extends keyof GameEventMap>(
    type: K,
    listener: (this: TypedEventTarget, ev: GameEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ): void {
    super.addEventListener(type, listener, options);
  }
}

export const gameBus = new TypedEventTarget();