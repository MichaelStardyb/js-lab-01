export interface LoopStats {
    fps: number;
    sps: number;
    frameMs: number;
}

export function createLoop({ step = 1/60, simulate, render }: { step?: number; simulate: (step: number) => void; render: (alpha: number, stats: LoopStats) => void }) {
    let accumulator = 0;
    let last = performance.now();
    let frameId: number | undefined;
    let frames = 0, steps = 0, lastFpsTime = last;
    let stats = { fps: 0, sps: 0, frameMs: 0 };

    function frame(now: number) {
        stats.frameMs = now - last;
        let dt = stats.frameMs / 1000;
        if (dt > 0.25) dt = 0.25; 
        last = now;
        accumulator += dt;

        while (accumulator >= step) {
            simulate(step);
            accumulator -= step;
            steps++;
        }
        render(accumulator / step, stats);
        frames++;

        if (now - lastFpsTime >= 1000) {
            stats.fps = frames;
            stats.sps = steps;
            frames = 0;
            steps = 0;
            lastFpsTime = now;
        }
        frameId = requestAnimationFrame(frame);
    }

    return {
        start: () => { last = performance.now(); frame(last); },
        stop: () => { if (frameId !== undefined) cancelAnimationFrame(frameId); }
    };
}