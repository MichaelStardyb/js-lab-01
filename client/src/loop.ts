export interface LoopStats {
    fps: number;
    sps: number;
    frameMs: number;
}

export interface LoopOptions {
    step?: number;
    simulate: (step: number) => void;
    render: (alpha: number, stats: LoopStats) => void;
    now?: () => number;
    raf?: (callback: (time: number) => void) => number;
    caf?: (id: number) => void;
}

export function createLoop({
    step = 1/60,
    simulate,
    render,
    now = () => performance.now(),
    raf = (cb) => requestAnimationFrame(cb),
    caf = (id) => cancelAnimationFrame(id),
}: LoopOptions) {
    let accumulator = 0;
    let last = now();
    let frameId: number | undefined;
    let frames = 0, steps = 0, lastFpsTime = last;
    let stats = { fps: 0, sps: 0, frameMs: 0 };

    function frame(currentTime: number) {
        stats.frameMs = currentTime - last;
        let dt = stats.frameMs / 1000;
        if (dt > 0.25) dt = 0.25; 
        last = currentTime;
        accumulator += dt;

        while (accumulator >= step) {
            simulate(step);
            accumulator -= step;
            steps++;
        }
        render(accumulator / step, stats);
        frames++;

        if (currentTime - lastFpsTime >= 1000) {
            stats.fps = frames;
            stats.sps = steps;
            frames = 0;
            steps = 0;
            lastFpsTime = currentTime;
        }
        frameId = raf(frame);
    }

    return {
        start: () => { last = now(); frame(last); },
        stop: () => { if (frameId !== undefined) caf(frameId); }
    };
}
