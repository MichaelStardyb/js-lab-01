import { describe, it, expect } from 'vitest';
import { integrate, type ShipState, type ShipInput } from 'shared/sim/ship.js';
import { DEFAULT_ARENA } from 'shared/sim/arena.js';

function shortestDelta(from: number, to: number, size: number) {
  return ((to - from + size / 2) % size + size) % size - size / 2;
}

function isSequenceAfter(sequence: number, previous: number) {
  const delta = (sequence - previous) >>> 0;
  return delta !== 0 && delta < 0x80000000;
}

type PendingInput = ShipInput & { seq: number };

function reconcile(
  serverState: ShipState,
  lastProcessedSeq: number,
  pendingInputs: PendingInput[],
  stepDt = 1 / 30
): { reconciledState: ShipState; remainingInputs: PendingInput[]; errorDelta: { dx: number; dy: number } } {
  const remainingInputs = pendingInputs.filter((item) => isSequenceAfter(item.seq, lastProcessedSeq));
  let state = { ...serverState };
  for (const input of remainingInputs) {
    state = integrate(state, input, stepDt, DEFAULT_ARENA);
  }
  return {
    reconciledState: state,
    remainingInputs,
    errorDelta: {
      dx: shortestDelta(serverState.x, state.x, DEFAULT_ARENA.width),
      dy: shortestDelta(serverState.y, state.y, DEFAULT_ARENA.height),
    },
  };
}

describe('client prediction and server reconciliation', () => {
  it('when server matches predicted state with all inputs confirmed, correction is zero', () => {
    let clientState: ShipState = { x: 400, y: 300, vx: 50, vy: 0, angle: 0 };
    const input: PendingInput = { seq: 10, thrust: true, turnLeft: false, turnRight: false };
    clientState = integrate(clientState, input, 1 / 30);

    const pending = [input];
    const serverState = { ...clientState };
    const lastProcessedSeq = 10;

    const result = reconcile(serverState, lastProcessedSeq, pending);
    expect(result.remainingInputs.length).toBe(0);
    expect(result.reconciledState.x).toBeCloseTo(clientState.x);
    expect(result.reconciledState.y).toBeCloseTo(clientState.y);
  });

  it('replays unconfirmed inputs on top of authoritative server snapshot', () => {
    const serverState: ShipState = { x: 400, y: 300, vx: 0, vy: 0, angle: 0 };
    const pending: PendingInput[] = [
      { seq: 1, thrust: true, turnLeft: false, turnRight: false },
      { seq: 2, thrust: true, turnLeft: false, turnRight: false },
      { seq: 3, thrust: true, turnLeft: false, turnRight: false },
    ];
    // Server has only processed input seq 1
    const lastProcessedSeq = 1;
    const result = reconcile(serverState, lastProcessedSeq, pending);

    // Inputs 2 and 3 replayed
    expect(result.remainingInputs.length).toBe(2);
    expect(result.reconciledState.x).toBeGreaterThan(serverState.x);
    expect(result.reconciledState.vx).toBeGreaterThan(0);
  });

  it('discards acknowledged inputs with seq <= lastProcessedSeq', () => {
    const pending: PendingInput[] = [
      { seq: 5, thrust: false, turnLeft: false, turnRight: false },
      { seq: 6, thrust: false, turnLeft: false, turnRight: false },
      { seq: 7, thrust: false, turnLeft: false, turnRight: false },
    ];
    const remaining = pending.filter((item) => isSequenceAfter(item.seq, 6));
    expect(remaining.map((r) => r.seq)).toEqual([7]);
  });

  it('isSequenceAfter correctly handles unsigned 32-bit sequence wraparound', () => {
    // Normal sequential numbers
    expect(isSequenceAfter(5, 4)).toBe(true);
    expect(isSequenceAfter(4, 5)).toBe(false);
    expect(isSequenceAfter(4, 4)).toBe(false);

    // 32-bit integer wraparound: 0 comes after 0xFFFFFFFF
    expect(isSequenceAfter(0, 0xFFFFFFFF)).toBe(true);
    expect(isSequenceAfter(1, 0xFFFFFFFF)).toBe(true);
    expect(isSequenceAfter(0xFFFFFFFF, 0)).toBe(false);
  });

  it('shortestDelta computes shortest toroidal path across arena edges', () => {
    // Direct delta inside arena
    expect(shortestDelta(100, 150, 800)).toBe(50);
    expect(shortestDelta(150, 100, 800)).toBe(-50);

    // Across wrapping boundary (from 790 to 10 on 800-width arena)
    expect(shortestDelta(790, 10, 800)).toBe(20);
    expect(shortestDelta(10, 790, 800)).toBe(-20);
  });

  it('visual offset exponentially decays toward zero over time', () => {
    let visualOffset = { x: 50, y: -30 };
    const frameMs = 16.67;

    // Simulate 10 frames (~167 ms)
    for (let i = 0; i < 10; i++) {
      visualOffset.x *= Math.exp(-frameMs / 100);
      visualOffset.y *= Math.exp(-frameMs / 100);
    }

    // Offset should be significantly smoothed toward zero
    expect(Math.abs(visualOffset.x)).toBeLessThan(10);
    expect(Math.abs(visualOffset.y)).toBeLessThan(6);
  });
});
