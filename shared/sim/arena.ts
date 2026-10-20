export const DEFAULT_ARENA = Object.freeze({ width: 800, height: 600 });

export type Arena = { readonly width: number; readonly height: number };
export type Position = { readonly x: number; readonly y: number };

export function wrapPosition(position: Position, arena: Arena = DEFAULT_ARENA): Position {
  return {
    x: ((position.x % arena.width) + arena.width) % arena.width,
    y: ((position.y % arena.height) + arena.height) % arena.height,
  };
}

export function wrapAngle(angle: number): number {
  const fullTurn = Math.PI * 2;
  return ((angle % fullTurn) + fullTurn) % fullTurn;
}

export function lerpAngle(from: number, to: number, alpha: number): number {
  const delta = ((to - from + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return wrapAngle(from + delta * alpha);
}
