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

describe('BrowserSession label ownership', () => {
  it('unloads a completed label load after reset before publishing it', async () => {
    let complete!: (volume: BrowserVolume) => void;
    const pending = new Promise<BrowserVolume>((resolve) => {
      complete = resolve;
    });
    const invoke = vi.fn(async () => null);
    const transport = {
      request: vi.fn(() => pending),
      invoke,
      dispose: vi.fn(),
    } as unknown as BrowserTransport;
    const session = new BrowserSession(transport);
    const loading = session.load(new File([], 'labels.nii'), true);
    await session.reset();
    complete({ ...movie, frameCount: 1, labelIds: [0, 17] });
    await loading;
    expect(session.store.getState().layers).toEqual([]);
    expect(invoke).toHaveBeenCalledWith('unload_volume', { volumeId: movie.id });
    session.dispose();
  });

  it('does not publish an old label lookup after crosshair movement or closure', async () => {
    let complete!: (id: number) => void;
    const lookup = new Promise<number>((resolve) => {
      complete = resolve;
    });
    const invoke = vi.fn(async (command: string) => {
      if (command === 'label_at_world') return lookup;
      if (command === 'render_view') return framePacket();
      return null;
    });
    const session = new BrowserSession({ invoke, dispose: vi.fn() } as unknown as BrowserTransport);
    session.store.setState({
      layers: [{ ...movie, frameCount: 1, labelIds: [0, 17], window: [0, 17], opacity: 1 }],
      selected: movie.id,
    });
    session.crosshair([0, 0, 0]);
    await Promise.resolve();
    await Promise.resolve();
    await session.reset();
    complete(17);
    await settle();
    expect(session.store.getState().selectedLabel).toBeNull();
    expect(invoke.mock.calls.filter(([command]) => command === 'render_view')).toEqual([]);
    session.dispose();
  });
});

describe('BrowserSession surface ownership', () => {
  const mesh = (id: string) => ({
    id,
    name: `${id}.gii`,
    vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    faces: new Uint32Array([0, 1, 2]),
    hemisphere: 'unknown',
  });
  it('discards a decoded surface after reset, without publishing geometry', async () => {
    let complete!: (value: ReturnType<typeof mesh>) => void;
    const request = vi.fn(
      () =>
        new Promise<ReturnType<typeof mesh>>((resolve) => {
          complete = resolve;
        }),
    );
    const transport = { request, invoke: vi.fn(), dispose: vi.fn() } as unknown as BrowserTransport;
    const session = new BrowserSession(transport);
    const pending = session.loadSurface(new File([], 'surface.gii'));
    await session.reset();
    complete(mesh('stale'));
    await pending;
    expect(session.surfaceGeometry).toBeNull();
    expect(session.store.getState().surface).toBeNull();
    session.dispose();
  });
  it('keeps the latest mesh, rejects stale renderer errors and drops ownership on unload', async () => {
    const completions: Array<(value: ReturnType<typeof mesh>) => void> = [];
    const request = vi.fn(
      () => new Promise<ReturnType<typeof mesh>>((resolve) => completions.push(resolve)),
    );
    const session = new BrowserSession({
      request,
      dispose: vi.fn(),
    } as unknown as BrowserTransport);
    const older = session.loadSurface(new File([], 'older.gii'));
    const newer = session.loadSurface(new File([], 'newer.gii'));
    completions[1](mesh('newer'));
    await newer;
    completions[0](mesh('older'));
    await older;
    expect(session.surfaceGeometry?.id).toBe('newer');
    session.surfaceError('older', new Error('stale GPU failure'));
    expect(session.surfaceGeometry?.id).toBe('newer');
    session.pickSurface([0, 0, 0], { handle: 'older', vertex: 0 });
    expect(session.store.getState().surfacePick).toBeNull();
    session.surfaceError('newer', new Error('GPU failure'));
    expect(session.surfaceGeometry).toBeNull();
    expect(session.store.getState().error).toBe('GPU failure');
    session.dispose();
  });
});
