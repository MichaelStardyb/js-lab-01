export const DEFAULT_ARENA = Object.freeze({ width: 800, height: 600 });

export function wrapPosition(position, arena = DEFAULT_ARENA) {
  return {
    x: ((position.x % arena.width) + arena.width) % arena.width,
    y: ((position.y % arena.height) + arena.height) % arena.height,
  };
}

export function wrapAngle(angle) {
  const fullTurn = Math.PI * 2;
  return ((angle % fullTurn) + fullTurn) % fullTurn;
}

export function lerpAngle(from, to, alpha) {
  const delta = ((to - from + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return wrapAngle(from + delta * alpha);
}
