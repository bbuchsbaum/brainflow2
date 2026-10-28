import { describe, expect, it, vi } from 'vitest';
import { BrowserSession } from './session';
import type { BrowserTransport } from './transport';
import {
  parseSessionRecord,
  restoreSessionRecord,
  type BrowserSessionRecord,
} from './sessionRecord';

const source = { name: 'surface.gii', size: 3, sha256: 'a'.repeat(64) };
const record = (): BrowserSessionRecord => ({
  format: 'brainflow-browser-session',
  version: 2,
  volumes: [],
  surfaces: [{ source }],
  selectedSurface: 0,
  selected: null,
  crosshair: [1, 2, 3],
  view: 'surface',
});
const mesh = {
  id: 'mesh',
  name: 'surface.gii',
  hemisphere: 'left',
  vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  faces: new Uint32Array([0, 1, 2]),
};
function host() {
  const transport = {
    request: vi.fn(async (cmd: string) => (cmd === 'describe_source' ? source : mesh)),
    invoke: vi.fn(async () => null),
    dispose: vi.fn(),
  };
  const session = new BrowserSession(transport as unknown as BrowserTransport);
  return { session, transport, create: () => session };
}

describe('versioned browser session records', () => {
  it('rejects unsupported versions and invalid navigation before starting a worker', () => {
    expect(parseSessionRecord(JSON.stringify(record()))).toEqual(record());
    for (const patch of [
      { version: 3 },
      { crosshair: [1, 2] },
      { selected: 0 },
      { volumes: [{}] },
      {
        surfaces: [
          {
            source,
            overlay: { source, kind: 'scalar', opacity: 1, range: [2, 1], colormap: 'gray' },
          },
        ],
      },
    ]) {
      expect(() => parseSessionRecord(JSON.stringify({ ...record(), ...patch }))).toThrow();
    }
  });
  it('validates projection source and sampling settings before restoration', () => {
    const saved: BrowserSessionRecord = {
      ...record(),
      volumes: [{ source, labels: true, window: [0, 1], opacity: 1, colormap: 'gray', frame: 0 }],
      surfaces: [
        { source, linked: true, overlay: { kind: 'projection', volume: 0, frame: 0, opacity: 1 } },
      ],
    };
    expect(parseSessionRecord(JSON.stringify(saved))).toEqual(saved);
    const scalar = structuredClone(saved);
    scalar.volumes[0].labels = false;
    expect(() => parseSessionRecord(JSON.stringify(scalar))).toThrow(/projection/);
    const unlinked = structuredClone(saved);
    unlinked.surfaces[0].linked = false;
    expect(() => parseSessionRecord(JSON.stringify(unlinked))).toThrow(/projection/);
    const absent = structuredClone(saved);
    absent.volumes = [];
    expect(() => parseSessionRecord(JSON.stringify(absent))).toThrow(/projection/);
  });
  it('returns an owned replacement only after verified sources load', async () => {
    const h = host();
    const file = new File(['abc'], 'renamed.gii');
    const restored = await restoreSessionRecord(
      record(),
      [file],
      new AbortController().signal,
      h.create,
    );
    expect(restored).toBe(h.session);
    expect(restored.activeSurface?.id).toBe('mesh');
    expect(h.transport.request.mock.calls.map(([cmd]) => cmd)).toEqual([
      'describe_source',
      'load_surface',
    ]);
    expect(h.transport.dispose).not.toHaveBeenCalled();
    restored.dispose();
  });
  it('rejects changed sources before loading and disposes the provisional worker', async () => {
    const h = host();
    const changed = record();
    changed.surfaces = [{ source: { ...source, sha256: 'b'.repeat(64) } }];
    await expect(
      restoreSessionRecord(
        changed,
        [new File(['abc'], source.name)],
        new AbortController().signal,
        h.create,
      ),
    ).rejects.toThrow('original contents');
    expect(h.transport.request).toHaveBeenCalledTimes(1);
    expect(h.transport.dispose).toHaveBeenCalledTimes(1);
  });
  it('disposes staged resources when decoding fails', async () => {
    const h = host();
    h.transport.request.mockImplementation(async (cmd: string) => {
      if (cmd === 'describe_source') return source;
      throw new Error('Invalid geometry');
    });
    await expect(
      restoreSessionRecord(
        record(),
        [new File(['abc'], source.name)],
        new AbortController().signal,
        h.create,
      ),
    ).rejects.toThrow('Invalid geometry');
    expect(h.transport.dispose).toHaveBeenCalledTimes(1);
  });
  it('never publishes a cancelled restoration even if a decoder resolves late', async () => {
    const h = host();
    const abort = new AbortController();
    h.transport.request.mockImplementation(async (cmd: string) => {
      if (cmd === 'describe_source') return source;
      abort.abort();
      return mesh;
    });
    await expect(
      restoreSessionRecord(record(), [new File(['abc'], source.name)], abort.signal, h.create),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(h.session.activeSurface).toBeNull();
    expect(h.transport.dispose).toHaveBeenCalled();
  });
  it('saves loaded source settings and drops source references on unload', async () => {
    const h = host();
    await h.session.loadSurface(new File(['abc'], source.name));
    const saved = await h.session.saveRecord();
    expect(saved.surfaces[0]?.source).toEqual(source);
    h.session.unloadSurface();
    expect((await h.session.saveRecord()).surfaces).toEqual([]);
    h.session.dispose();
  });
});

describe('portable surface camera settings', () => {
  const camera = {
    position: [1, 2, 3],
    target: [0, 0, 0],
    rotation: [0, 0, 0, 'XYZ'],
    up: [0, 1, 0],
    zoom: 2,
  };
  it('accepts finite orbit/zoom and refuses degenerate or malformed camera state', () => {
    const settings = { ...record(), camera };
    expect(parseSessionRecord(JSON.stringify(settings)).camera).toEqual(camera);
    for (const patch of [
      { zoom: 0 },
      { zoom: -1 },
      { position: [0, 0, 0] },
      { position: [1, 2] },
      { target: [null, 0, 0] },
      { rotation: [0, 0, 0, 'BAD'] },
    ]) {
      expect(() =>
        parseSessionRecord(JSON.stringify({ ...settings, camera: { ...camera, ...patch } })),
      ).toThrow('camera');
    }
  });
});

it('migrates version-1 single-surface settings without losing source, link or camera', () => {
  const legacy = {
    format: 'brainflow-browser-session',
    version: 1,
    volumes: [],
    surface: {
      source,
      linked: true,
      camera: {
        position: [1, 2, 3],
        target: [0, 0, 0],
        rotation: [0, 0, 0, 'XYZ'],
        up: [0, 1, 0],
        zoom: 2,
      },
    },
    selected: null,
    crosshair: [1, 2, 3],
    view: 'surface',
  };
  const migrated = parseSessionRecord(JSON.stringify(legacy));
  expect(migrated.version).toBe(2);
  expect(migrated.surfaces[0].source).toEqual(source);
  expect(migrated.surfaces[0].linked).toBe(true);
  expect(migrated.camera).toEqual(legacy.surface.camera);
  expect(migrated.selectedSurface).toBe(0);
});
