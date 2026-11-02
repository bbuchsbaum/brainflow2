/**
 * The frame a programmatic open is about to land on, by file. A load cannot
 * carry it, and the first window is computed before the load returns: without
 * this it reads frame 0, which in a run with a bright start dims every other
 * frame until the all-frame window arrives.
 */
const frames = new Map<string, number>();

export function expectLandingFrame(path: string, frame: number): void {
  frames.set(path, frame);
}

export function forgetLandingFrame(path: string): void {
  frames.delete(path);
}

export const landingFrameOf = (path: string | undefined): number | undefined =>
  path === undefined ? undefined : frames.get(path);
