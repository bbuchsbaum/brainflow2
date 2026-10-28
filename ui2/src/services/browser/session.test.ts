import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserSession } from './session';
import type { BrowserVolume } from './protocol';
import type { BrowserTransport } from './transport';

const framePacket = () => {
  const packet = new Uint8Array(12);
  new DataView(packet.buffer).setUint32(0, 1, true);
  new DataView(packet.buffer).setUint32(4, 1, true);
  packet.set([10, 20, 30, 255], 8);
  return packet;
};

const movie: BrowserVolume = {
  id: 'movie',
  name: 'movie.nii',
  dims: [2, 2, 2],
  affine: [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ],
  center: [0.5, 0.5, 0.5],
  bounds: [
    [-0.5, -0.5, -0.5],
    [1.5, 1.5, 1.5],
  ],
  range: [0, 1],
  frameCount: 4,
  currentFrame: 0,
};

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

afterEach(() => vi.useRealTimers());

describe('BrowserSession time series', () => {
  it('coalesces rapid frame changes and never publishes the stale selection', async () => {
    let releaseFirst: (() => void) | undefined;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const changes: number[] = [];
    const transport = {
      invoke: vi.fn(async (command: string, args?: { timepoint?: number }) => {
        if (command === 'set_timepoint') {
          changes.push(args!.timepoint!);
          if (args!.timepoint === 1) await first;
          return null;
        }
        if (command === 'render_view') return framePacket();
        return null;
      }),
      dispose: vi.fn(),
    } as unknown as BrowserTransport;
    const session = new BrowserSession(transport);
    session.store.setState({
      layers: [{ ...movie, window: [0, 1], opacity: 1 }],
      selected: movie.id,
      crosshair: movie.center,
    });

    session.setTimepoint(movie.id, 1);
    session.setTimepoint(movie.id, 3);
    releaseFirst!();
    await settle();

    expect(changes).toEqual([1, 3]);
    expect(session.store.getState().layers[0].currentFrame).toBe(3);
    expect(session.store.getState().frameRevision).toBe(1);
    session.dispose();
  });

  it('stops playback and ignores a frame completion after reset', async () => {
    let releaseFrame: (() => void) | undefined;
    const frame = new Promise<void>((resolve) => {
      releaseFrame = resolve;
    });
    const transport = {
      invoke: vi.fn(async (command: string) => {
        if (command === 'set_timepoint') await frame;
        if (command === 'render_view') return framePacket();
        return null;
      }),
      dispose: vi.fn(),
    } as unknown as BrowserTransport;
    const session = new BrowserSession(transport);
    session.store.setState({
      layers: [{ ...movie, window: [0, 1], opacity: 1 }],
      selected: movie.id,
      crosshair: movie.center,
    });
    session.togglePlayback(movie.id);
    await session.reset();
    releaseFrame!();
    await settle();

    expect(session.store.getState().playing).toBeNull();
    expect(session.store.getState().layers).toEqual([]);
    session.dispose();
  });

  it('advances playback only after the current frame is rendered', async () => {
    vi.useFakeTimers();
    const changes: number[] = [];
    const transport = {
      invoke: vi.fn(async (command: string, args?: { timepoint?: number }) => {
        if (command === 'set_timepoint') changes.push(args!.timepoint!);
        if (command === 'render_view') return framePacket();
        return null;
      }),
      dispose: vi.fn(),
    } as unknown as BrowserTransport;
    const session = new BrowserSession(transport);
    session.store.setState({
      layers: [{ ...movie, window: [0, 1], opacity: 1 }],
      selected: movie.id,
      crosshair: movie.center,
    });

    session.togglePlayback(movie.id);
    await vi.runAllTicks();
    expect(changes).toEqual([0]);
    await vi.advanceTimersByTimeAsync(250);
    expect(session.store.getState().layers[0].currentFrame).toBe(1);
    await session.reset();
    await vi.advanceTimersByTimeAsync(500);
    expect(session.store.getState().playing).toBeNull();
    session.dispose();
  });
});
