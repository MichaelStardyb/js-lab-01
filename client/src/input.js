export function createInput(target) {
    const down = new Set();
    target.addEventListener("keydown", e => down.add(e.code));
    target.addEventListener("keyup", e => down.delete(e.code));
    return { isDown: code => down.has(code) };
}