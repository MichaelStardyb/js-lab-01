export function createInput(target: EventTarget) {
    const down = new Set<string>();
    target.addEventListener("keydown", (e: Event) => {
        if (e instanceof KeyboardEvent) down.add(e.code);
    });
    target.addEventListener("keyup", (e: Event) => {
        if (e instanceof KeyboardEvent) down.delete(e.code);
    });
    return { isDown: (code: string) => down.has(code) };
}