import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserSession } from './session';
import type { BrowserVolume, BrowserSurface } from './protocol';
import type { BrowserTransport } from './transport';

function seedSurface(session: BrowserSession, mesh: BrowserSurface) {
  session.surfaceResources.clear();
  session.surfaceResources.set(mesh.id, {
    geometry: mesh,
    source: null,
    overlaySource: null,
    values: null,
    labels: null,
    overlayRequest: 0,
  });
  session.store.setState({
    selectedSurface: mesh.id,
    surfaces: [
      {
        id: mesh.id,
        name: mesh.name,
        vertices: mesh.vertices.length / 3,
        faces: mesh.faces.length / 3,
        hemisphere: mesh.hemisphere,
        overlay: null,
        linked: false,
      },
    ],
  });
}

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
    expect(session.activeSurface).toBeNull();
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

describe('BrowserSession scalar surface map ownership', () => {
  const mesh = {
    id: 'mesh',
    name: 'mesh.gii',
    vertices: new Float32Array(9),
    faces: new Uint32Array([0, 1, 2]),
    hemisphere: 'left',
  };
  function setup() {
    const pending: Array<{
      resolve: (values: Float32Array) => void;
      reject: (error: Error) => void;
    }> = [];
    const request = vi.fn(
      () => new Promise<Float32Array>((resolve, reject) => pending.push({ resolve, reject })),
    );
    const session = new BrowserSession({
      request,
      invoke: vi.fn(),
      dispose: vi.fn(),
    } as unknown as BrowserTransport);
    seedSurface(session, mesh);
    return { session, pending };
  }
  it('keeps the newest map and preserves it on failed replacement', async () => {
    const { session, pending } = setup();
    const old = session.loadSurfaceOverlay(new File([], 'old.gii'));
    const latest = session.loadSurfaceOverlay(new File([], 'latest.gii'));
    pending[1].resolve(new Float32Array([-3, 0, 8]));
    await latest;
    pending[0].resolve(new Float32Array([1, 2, 3]));
    await old;
    expect((session.activeSurface?.overlay ?? null)?.name).toBe('latest.gii');
    expect(session.activeSurface?.overlay ?? null).toMatchObject({ range: [-3, 8] });
    const wrong = session.loadSurfaceOverlay(new File([], 'wrong.gii'));
    pending[2].resolve(new Float32Array([1, 2]));
    await wrong;
    expect(session.store.getState().error).toContain('surface requires 3');
    expect([...session.surfaceValues!]).toEqual([-3, 0, 8]);
    session.updateSurfaceOverlay({ opacity: 0.4, colormap: 'gray', range: [-2, 4] });
    expect(session.activeSurface?.overlay ?? null).toMatchObject({
      opacity: 0.4,
      colormap: 'gray',
      range: [-2, 4],
    });
    session.updateSurfaceOverlay({ range: [4, -2] });
    expect(session.activeSurface?.overlay ?? null).toMatchObject({ range: [-2, 4] });
    session.dispose();
    expect(session.surfaceValues).toBeNull();
  });
  it.each(['cancel', 'remove', 'unload', 'reset', 'close', 'replace'] as const)(
    'discards a pending map after %s',
    async (action) => {
      const { session, pending } = setup();
      const load = session.loadSurfaceOverlay(new File([], 'late.gii'));
      if (action === 'cancel') session.cancelLoads();
      if (action === 'remove') session.removeSurfaceOverlay();
      if (action === 'unload') session.unloadSurface();
      if (action === 'reset') await session.reset();
      if (action === 'close') session.dispose();
      if (action === 'replace') seedSurface(session, { ...mesh, id: 'replacement' });
      pending[0].resolve(new Float32Array([1, 2, 3]));
      await load;
      expect(session.surfaceValues).toBeNull();
      expect(session.activeSurface?.overlay ?? null).toBeNull();
      session.dispose();
    },
  );
});

describe('BrowserSession categorical surface attachment', () => {
  const mesh = {
    id: 'mesh',
    name: 'mesh.gii',
    vertices: new Float32Array(9),
    faces: new Uint32Array([0, 1, 2]),
    hemisphere: 'left',
  };
  const labelMap = () => ({
    labels: new Uint32Array([0, 17, 16777217]),
    rgba: new Float32Array(12),
    legend: [
      {
        id: 16777217,
        name: 'Exact region',
        rgba: [0, 1, 0, 1] as [number, number, number, number],
      },
    ],
  });
  function setup() {
    const completions: Array<(map: Float32Array | ReturnType<typeof labelMap>) => void> = [];
    const request = vi.fn<(command: string) => Promise<Float32Array | ReturnType<typeof labelMap>>>(
      () =>
        new Promise<Float32Array | ReturnType<typeof labelMap>>((resolve) =>
          completions.push(resolve),
        ),
    );
    const session = new BrowserSession({
      request,
      invoke: vi.fn(),
      dispose: vi.fn(),
    } as unknown as BrowserTransport);
    seedSurface(session, mesh);
    return { session, completions, request };
  }
  it('replaces scalar and categorical maps without retaining the prior arrays', async () => {
    const { session, completions, request } = setup();
    const first = session.loadSurfaceOverlay(new File([], 'scalar.gii'));
    completions[0](new Float32Array([1, 2, 3]));
    await first;
    const labels = session.loadSurfaceOverlay(new File([], 'labels.gii'), true);
    completions[1](labelMap());
    await labels;
    expect(request.mock.calls[1][0]).toBe('load_surface_labels');
    expect(session.surfaceValues).toBeNull();
    expect(session.surfaceLabels?.labels[2]).toBe(16777217);
    expect(session.activeSurface?.overlay ?? null).toMatchObject({ kind: 'labels' });
    session.updateSurfaceOverlay({ opacity: 0.3, range: [0, 1], colormap: 'hot' });
    expect(session.activeSurface?.overlay ?? null).toMatchObject({ kind: 'labels', opacity: 0.3 });
    expect(session.activeSurface?.overlay ?? null).not.toHaveProperty('colormap');
    const wrong = session.loadSurfaceOverlay(new File([], 'wrong.gii'), true);
    completions[2]({ ...labelMap(), labels: new Uint32Array([17]) });
    await wrong;
    expect(session.surfaceLabels?.labels[2]).toBe(16777217);
    const older = session.loadSurfaceOverlay(new File([], 'older.gii'), true);
    const scalar = session.loadSurfaceOverlay(new File([], 'newer.gii'));
    completions[4](new Float32Array([3, 4, 5]));
    await scalar;
    completions[3](labelMap());
    await older;
    expect(session.surfaceLabels).toBeNull();
    expect([...session.surfaceValues!]).toEqual([3, 4, 5]);
    session.dispose();
  });
  it.each(['cancel', 'remove', 'unload', 'reset', 'close', 'replace'] as const)(
    'discards pending label attachment after %s',
    async (action) => {
      const { session, completions } = setup();
      const pending = session.loadSurfaceOverlay(new File([], 'labels.gii'), true);
      if (action === 'cancel') session.cancelLoads();
      if (action === 'remove') session.removeSurfaceOverlay();
      if (action === 'unload') session.unloadSurface();
      if (action === 'reset') await session.reset();
      if (action === 'close') session.dispose();
      if (action === 'replace') seedSurface(session, { ...mesh, id: 'newer' });
      completions[0](labelMap());
      await pending;
      expect(session.surfaceLabels).toBeNull();
      expect(session.activeSurface?.overlay ?? null).toBeNull();
      session.dispose();
    },
  );
});

describe('restored presentation ownership', () => {
  it('rejects render failures and cancellation rather than accepting an unpresented workspace', async () => {
    const transport = { dispose: vi.fn() } as unknown as BrowserTransport;
    const session = new BrowserSession(transport);
    session.store.setState({ layers: [{ ...movie, window: [0, 1], opacity: 1 }] });
    const first = session.whenPresented(new AbortController().signal);
    session.store.setState({ error: 'GPU conversion failed' });
    await expect(first).rejects.toThrow('GPU conversion failed');
    session.store.setState({ error: null });
    const abort = new AbortController();
    const second = session.whenPresented(abort.signal);
    abort.abort();
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    session.dispose();
  });
});

describe('explicit anatomical surface linking', () => {
  function linkedSession(surfaceType = 'pial') {
    const transport = {
      invoke: vi.fn(async () => framePacket()),
      dispose: vi.fn(),
    } as unknown as BrowserTransport;
    const session = new BrowserSession(transport);
    seedSurface(session, {
      id: 'mesh',
      name: 'mesh',
      hemisphere: 'left',
      surfaceType,
      vertices: new Float32Array([10, 20, 30]),
      faces: new Uint32Array(),
    });
    session.store.setState({ layers: [{ ...movie, frameCount: 1, window: [0, 1], opacity: 1 }] });
    return session;
  }
  it('requires explicit linking and preserves exact world points beyond volume bounds', async () => {
    const session = linkedSession();
    session.pickSurface([10, 20, 30], { handle: 'mesh', vertex: 0 });
    expect(session.store.getState().crosshair).toEqual([0, 0, 0]);
    session.setSurfaceLink(true);
    session.pickSurface([10, 20, 30], { handle: 'mesh', vertex: 0 });
    expect(session.store.getState().crosshair).toEqual([10, 20, 30]);
    await settle();
    session.unloadSurface();
    expect(session.activeSurface?.linked ?? false).toBe(false);
    session.dispose();
  });
  it('refuses known deformations and stale or invalid picks', () => {
    for (const type of ['inflated', 'spherical', 'flat']) {
      const session = linkedSession(type);
      session.setSurfaceLink(true);
      expect(session.activeSurface?.linked ?? false).toBe(false);
      expect(session.store.getState().error).toContain('anatomical companion');
      session.dispose();
    }
    const session = linkedSession();
    session.setSurfaceLink(true);
    for (const pick of [
      { handle: 'old', vertex: 0 },
      { handle: 'mesh', vertex: -1 },
      { handle: 'mesh', vertex: 1 },
      { handle: 'mesh', vertex: 0.5 },
    ]) {
      session.pickSurface([10, 20, 30], pick);
    }
    expect(session.store.getState().surfacePick).toBeNull();
    expect(session.store.getState().crosshair).toEqual([0, 0, 0]);
    session.dispose();
  });
});

describe('paired hemisphere ownership', () => {
  function pairedSession() {
    let serial = 0;
    const transport = {
      request: vi.fn(async (cmd: string, args: { file: File }) => {
        if (cmd === 'load_surface')
          return {
            id: `surface-${++serial}`,
            name: args.file.name,
            hemisphere: args.file.name.startsWith('left') ? 'left' : 'right',
            surfaceType: 'pial',
            vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
            faces: new Uint32Array([0, 1, 2]),
          };
        return new Float32Array([1, 2, 3]);
      }),
      dispose: vi.fn(),
    };
    return { session: new BrowserSession(transport as unknown as BrowserTransport), transport };
  }
  it('keeps per-hemisphere overlays through selection, rejects duplicate sides, and unloads independently', async () => {
    const { session } = pairedSession();
    await session.loadSurface(new File([], 'left.gii'));
    const left = session.activeSurface!.id;
    await session.loadSurfaceOverlay(new File([], 'left-map.gii'));
    await session.loadSurface(new File([], 'right.gii'), true);
    const right = session.activeSurface!.id;
    expect(session.store.getState().surfaces).toHaveLength(2);
    expect(session.surfaceValues).toBeNull();
    await session.loadSurfaceOverlay(new File([], 'right-map.gii'));
    session.selectSurface(left);
    expect(session.activeSurface?.overlay?.name).toBe('left-map.gii');
    await session.loadSurface(new File([], 'left-duplicate.gii'), true);
    expect(session.store.getState().error).toContain('one left and one right');
    expect(session.store.getState().surfaces).toHaveLength(2);
    session.unloadSurface(left);
    expect(session.activeSurface?.id).toBe(right);
    expect(session.activeSurface?.overlay?.name).toBe('right-map.gii');
    expect(session.surfaceResources.has(left)).toBe(false);
    session.dispose();
    expect(session.surfaceResources.size).toBe(0);
  });
  it('attaches an in-flight map to its original hemisphere after selection switches', async () => {
    const { session, transport } = pairedSession();
    await session.loadSurface(new File([], 'left.gii'));
    const left = session.activeSurface!.id;
    await session.loadSurface(new File([], 'right.gii'), true);
    const right = session.activeSurface!.id;
    session.selectSurface(left);
    let finish!: (value: Float32Array) => void;
    transport.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const loading = session.loadSurfaceOverlay(new File([], 'left-late.gii'));
    session.selectSurface(right);
    finish(new Float32Array([1, 2, 3]));
    await loading;
    expect(session.activeSurface?.overlay).toBeNull();
    expect(
      session.store.getState().surfaces.find((surface) => surface.id === left)?.overlay?.name,
    ).toBe('left-late.gii');
    session.dispose();
  });
});

describe('projected frame ownership', () => {
  function setup() {
    const data = { values: new Float32Array([1]), dims: [1, 1, 1], affine: new Float32Array(16) };
    const transport = {
      request: vi.fn(async () => data),
      invoke: vi.fn(async () => null),
      dispose: vi.fn(),
    };
    const session = new BrowserSession(transport as unknown as BrowserTransport);
    seedSurface(session, {
      id: 'left',
      name: 'left',
      hemisphere: 'left',
      surfaceType: 'pial',
      vertices: new Float32Array([0, 0, 0]),
      faces: new Uint32Array(),
    });
    session.store.setState({
      layers: [{ ...movie, window: [0, 1], opacity: 1 }],
      selected: movie.id,
    });
    session.setSurfaceLink(true);
    return { session, transport, data };
  }
  it('uses the captured frame, shares it between hemispheres, and releases on source unload', async () => {
    const { session, transport, data } = setup();
    await session.projectVolume(movie.id, 2);
    expect(transport.request).toHaveBeenCalledWith(
      'projection_frame',
      { volumeId: movie.id, timepoint: 2 },
      expect.any(AbortSignal),
    );
    session.surfaceResources.set('right', {
      ...session.surfaceResources.get('left')!,
      projection: undefined,
    });
    session.store.setState({
      surfaces: [
        ...session.store.getState().surfaces,
        { ...session.activeSurface!, id: 'right', hemisphere: 'right', overlay: null },
      ],
      selectedSurface: 'right',
    });
    await session.projectVolume(movie.id, 2);
    expect(transport.request).toHaveBeenCalledTimes(1);
    expect(session.surfaceResources.get('right')?.projection?.data).toBe(data);
    await session.remove(movie.id);
    expect([...session.surfaceResources.values()].every((r) => r.projection === undefined)).toBe(
      true,
    );
    expect(session.store.getState().surfaces.every((s) => s.overlay === null)).toBe(true);
    session.dispose();
  });
  it('projects label IDs with nearest sampling and the volume palette, then releases on unlink', async () => {
    const { session, data } = setup();
    data.affine.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    session.surfaceResources.get('left')!.geometry.vertices = new Float32Array([
      0, 0, 0, 0.5, 0, 0,
    ]);
    session.store.setState({
      layers: [
        {
          ...session.store.getState().layers[0],
          labelIds: [1],
          legend: [{ label_id: 1, roi: 'Region one', color: [255, 0, 0] }],
        },
      ],
    });
    await session.projectVolume();
    expect(session.activeSurface!.overlay).toMatchObject({
      kind: 'labels',
      projection: { volumeId: movie.id },
    });
    expect([...session.surfaceLabels!.labels]).toEqual([1, 0]);
    expect([...session.surfaceLabels!.rgba]).toEqual([1, 0, 0, 1, 0, 0, 0, 0]);
    expect(session.surfaceLabels!.legend[1].name).toBe('Region one');
    session.setSurfaceLink(false);
    expect(session.surfaceLabels).toBeNull();
    expect(session.surfaceResources.get('left')!.projection).toBeUndefined();
    session.dispose();
  });
  it('rejects late projection after unload, cancellation or revoked coordinate linking', async () => {
    for (const action of ['unload', 'cancel', 'unlink']) {
      const { session, transport, data } = setup();
      let finish!: (value: typeof data) => void;
      transport.request.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const pending = session.projectVolume();
      if (action === 'unload') await session.remove(movie.id);
      else if (action === 'cancel') session.cancelLoads();
      else session.setSurfaceLink(false);
      finish(data);
      await pending;
      expect(session.surfaceResources.get('left')?.projection).toBeUndefined();
      expect(session.activeSurface?.overlay).toBeNull();
      session.dispose();
    }
  });
});

describe('fatal browser worker failure', () => {
  it('releases presented frames and surface buffers and rejects late publication', () => {
    const transport = { invoke: vi.fn(), dispose: vi.fn() } as unknown as BrowserTransport;
    const session = new BrowserSession(transport);
    const close = vi.fn();
    session.frames.set('axial', { close } as unknown as ImageBitmap);
    seedSurface(session, {
      id: 'mesh',
      name: 'mesh',
      vertices: new Float32Array(9),
      faces: new Uint32Array([0, 1, 2]),
      hemisphere: 'left',
    });
    session.store.setState({ ready: true, layers: [{ ...movie, window: [0, 1], opacity: 1 }] });
    transport.onFailure!(new Error('GPU device was lost'));
    expect(close).toHaveBeenCalledOnce();
    expect(transport.dispose).toHaveBeenCalledOnce();
    expect(session.surfaceResources.size).toBe(0);
    expect(session.frames.size).toBe(0);
    expect(session.store.getState()).toMatchObject({
      ready: false,
      layers: [],
      surfaces: [],
      error: 'GPU device was lost',
    });
    transport.onFailure!(new Error('duplicate loss'));
    expect(session.store.getState().error).toBe('GPU device was lost');
  });
});
