/**
 * qa-features-2026-10-31 §7: the first screen (MNI T1, crosshair at the
 * origin, "Drop a map here") for a cold start with nothing restored.
 */
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  runFirstScreen,
  useFirstScreenStore,
  type FirstScreenBackend,
} from '../firstScreenService';
import { FirstScreenHint } from '@/components/layout/FirstScreenHint';
import { useLayerStore } from '@/stores/layerStore';
import { useLayoutSettingsStore } from '@/stores/layoutSettingsStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { useLogStore } from '@/stores/logStore';
import { useLoadingQueueStore } from '@/stores/loadingQueueStore';
import { firstScreenAppliesAtLaunch, restoredLaunchFirstScreenTarget } from '../firstScreenService';

const WORKSPACE = 'orthogonal-flexible-1';

const setLayers = (ids: string[]) =>
  useLayerStore.setState({
    layers: ids.map((id) => ({
      id,
      name: id,
      sourcePath: id.startsWith('layer-MNI') ? `template:${id.slice('layer-'.length)}` : `/data/${id}`,
    })) as never,
  });
const layerIds = () => useLayerStore.getState().layers.map((layer) => layer.id);

function makeBackend(cached: string[], options: { onLoad?: () => void } = {}) {
  const backend: FirstScreenBackend = {
    isCached: vi.fn(async (id: string) => cached.includes(id)),
    cacheTemplate: vi.fn(async () => true),
    loadTemplate: vi.fn(async (id: string) => {
      options.onLoad?.();
      setLayers([...layerIds(), `layer-${id}`]);
    }),
    crosshairToOrigin: vi.fn(),
  };
  return backend;
}

beforeEach(() => {
  setLayers([]);
  useLoadingQueueStore.setState({ queue: [], activeLoads: new Map() });
  useLayerStore.setState({ loadingLayers: new Set() });
  useLayoutSettingsStore.getState().setFirstScreenTemplate(true);
  useWorkspaceStore.setState({
    workspaces: new Map([[WORKSPACE, { id: WORKSPACE, type: 'orthogonal-flexible' } as never]]),
    activeWorkspaceId: WORKSPACE,
  });
  useFirstScreenStore.setState({ phase: 'idle', workspaceId: null, templateLayerIds: [] });
});

describe('first screen', () => {
  it('shows the cached 1 mm T1 with the crosshair at the origin and the drop hint', async () => {
    const backend = makeBackend(['MNI152NLin2009cAsym_T1w_1mm', 'MNI152NLin2009cAsym_T1w_2mm']);
    expect(await runFirstScreen(WORKSPACE, backend)).toBe('shown');
    expect(backend.loadTemplate).toHaveBeenCalledWith('MNI152NLin2009cAsym_T1w_1mm');
    expect(backend.cacheTemplate).not.toHaveBeenCalled();
    expect(backend.crosshairToOrigin).toHaveBeenCalledTimes(1);

    render(<FirstScreenHint workspaceId={WORKSPACE} />);
    expect(screen.getByText('Drop a map here')).toBeInTheDocument();
    // Not in another tab.
    const other = render(<FirstScreenHint workspaceId="mosaic-2" />);
    expect(other.container.querySelector('[data-testid="first-screen-hint"]')).toBeNull();

    // The first load ends it.
    act(() => setLayers(['layer-MNI152NLin2009cAsym_T1w_1mm', 'zstat1']));
    expect(screen.queryByText('Drop a map here')).toBeNull();
    expect(useFirstScreenStore.getState().phase).toBe('done');
  });

  it('downloads the 2 mm T1 in the background when nothing is cached', async () => {
    const backend = makeBackend([]);
    let release!: () => void;
    (backend.cacheTemplate as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise<boolean>((resolve) => (release = () => resolve(true))),
    );
    const run = runFirstScreen(WORKSPACE, backend);
    await vi.waitFor(() => expect(useFirstScreenStore.getState().phase).toBe('downloading'));
    render(<FirstScreenHint workspaceId={WORKSPACE} />);
    expect(screen.getByText(/Downloading the MNI template in the background/)).toBeInTheDocument();
    expect(screen.getByTestId('first-screen-hint').className).toContain('pointer-events-none');

    release();
    expect(await run).toBe('shown');
    expect(backend.cacheTemplate).toHaveBeenCalledWith('MNI152NLin2009cAsym_T1w_2mm');
    expect(backend.loadTemplate).toHaveBeenCalledWith('MNI152NLin2009cAsym_T1w_2mm');
  });

  it('never adds the template once the user has loaded something during the download', async () => {
    const backend = makeBackend([]);
    (backend.cacheTemplate as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      setLayers(['user-map']);
      return true;
    });
    expect(await runFirstScreen(WORKSPACE, backend)).toBe('superseded');
    expect(backend.loadTemplate).not.toHaveBeenCalled();
    expect(useFirstScreenStore.getState().phase).toBe('done');
  });

  it('does nothing when switched off in Settings, or when something is already loaded', async () => {
    useLayoutSettingsStore.getState().setFirstScreenTemplate(false);
    const off = makeBackend(['MNI152NLin2009cAsym_T1w_2mm']);
    expect(await runFirstScreen(WORKSPACE, off)).toBe('skipped');
    expect(off.isCached).not.toHaveBeenCalled();

    useLayoutSettingsStore.getState().setFirstScreenTemplate(true);
    setLayers(['restored']);
    const busy = makeBackend(['MNI152NLin2009cAsym_T1w_2mm']);
    expect(await runFirstScreen(WORKSPACE, busy)).toBe('skipped');
    expect(busy.loadTemplate).not.toHaveBeenCalled();
  });

  it('stays quiet when the download fails', async () => {
    const backend = makeBackend([]);
    (backend.cacheTemplate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('offline'));
    expect(await runFirstScreen(WORKSPACE, backend)).toBe('failed');
    expect(backend.loadTemplate).not.toHaveBeenCalled();
    expect(useFirstScreenStore.getState().phase).toBe('done');
  });

  // The dev harness and the browser mock cannot download: nothing at all,
  // no status hint and no Log warning, so the empty scenarios stay empty.
  it('stays empty and silent on a host that cannot download', async () => {
    useLogStore.getState().clear();
    const backend = makeBackend([]);
    (backend.cacheTemplate as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const phases: string[] = [];
    const off = useFirstScreenStore.subscribe((s) => phases.push(s.phase));
    expect(await runFirstScreen(WORKSPACE, backend)).toBe('skipped');
    off();
    expect(phases).not.toContain('downloading');
    expect(backend.loadTemplate).not.toHaveBeenCalled();
    expect(useLogStore.getState().entries).toEqual([]);
  });

  it('the browser mock transport answers like that host', async () => {
    const { getTransport } = await import('@/services/transport');
    const transport = getTransport();
    // Only meaningful for the mock; the Tauri transport is not used in tests.
    expect(await transport.invoke('get_template_entry', { templateId: 'x' })).toBeNull();
    expect(await transport.invoke('cache_template', { templateId: 'x' })).toBe(false);
  });

  it('loads the T1 without a toast', async () => {
    const loadTemplateById = vi.fn(async () => {});
    vi.doMock('@/services/TemplateService', () => ({
      getTemplateService: () => ({ loadTemplateById }),
    }));
    const { defaultFirstScreenBackend } = await import('../firstScreenService');
    const backend = await defaultFirstScreenBackend();
    await backend.loadTemplate('MNI152NLin2009cAsym_T1w_2mm');
    expect(loadTemplateById).toHaveBeenCalledWith('MNI152NLin2009cAsym_T1w_2mm', { quiet: true });
    vi.doUnmock('@/services/TemplateService');
  });

  // Review M2: a file the user opened is in the loading queue before its
  // layer exists; the first screen must not start (or add the T1) then.
  it('does not start while the user has a load in the queue', async () => {
    useLoadingQueueStore.setState({
      activeLoads: new Map([['q1', { id: 'q1', path: '/data/zstat1.nii.gz', status: 'loading' } as never]]),
    });
    const backend = makeBackend(['MNI152NLin2009cAsym_T1w_2mm']);
    expect(await runFirstScreen(WORKSPACE, backend)).toBe('skipped');
    expect(backend.loadTemplate).not.toHaveBeenCalled();
  });

  it('a file that lands with the T1 gets no hint and keeps the crosshair', async () => {
    const backend = makeBackend(['MNI152NLin2009cAsym_T1w_2mm'], {
      onLoad: () => setLayers([...layerIds(), 'zstat1']),
    });
    expect(await runFirstScreen(WORKSPACE, backend)).toBe('superseded');
    expect(backend.crosshairToOrigin).not.toHaveBeenCalled();
    expect(useFirstScreenStore.getState().phase).toBe('done');
  });

  it('only a layer from that template counts as the T1', async () => {
    const backend = makeBackend(['MNI152NLin2009cAsym_T1w_2mm']);
    (backend.loadTemplate as ReturnType<typeof vi.fn>).mockImplementation(async () =>
      setLayers(['zstat1']),
    );
    expect(await runFirstScreen(WORKSPACE, backend)).toBe('superseded');
    expect(backend.crosshairToOrigin).not.toHaveBeenCalled();
  });

  // Review M3: the download hint goes as soon as the user loads something.
  it('hides the download hint once the user loads or queues a file', () => {
    useFirstScreenStore.setState({ phase: 'downloading', workspaceId: WORKSPACE, templateLayerIds: [] });
    render(<FirstScreenHint workspaceId={WORKSPACE} />);
    expect(screen.getByTestId('first-screen-hint')).toBeInTheDocument();
    act(() =>
      useLoadingQueueStore.setState({
        queue: [{ id: 'q', path: '/data/a.nii', status: 'queued' } as never],
      }),
    );
    expect(screen.queryByTestId('first-screen-hint')).toBeNull();
    act(() => {
      useLoadingQueueStore.setState({ queue: [] });
      setLayers(['zstat1']);
    });
    expect(screen.queryByTestId('first-screen-hint')).toBeNull();
  });

  // Review low: restored surface placeholders are a restored session.
  it('runs at launch only when nothing at all was restored', () => {
    expect(firstScreenAppliesAtLaunch({ restoredWorkspaces: 0, restoredSurfaceTabs: false })).toBe(true);
    expect(firstScreenAppliesAtLaunch({ restoredWorkspaces: 0, restoredSurfaceTabs: true })).toBe(false);
    expect(firstScreenAppliesAtLaunch({ restoredWorkspaces: 2, restoredSurfaceTabs: false })).toBe(false);
  });

  // QA 2026-10-31 N4: closing the last tab leaves the app's own default view,
  // which is persisted; restoring only that is not a restored session.
  it("the app's own default view does not count as a restored session", () => {
    const applies = (workspaces: Array<{ defaultView?: boolean }>, restoredSurfaceTabs = false) =>
      firstScreenAppliesAtLaunch({ restoredWorkspaces: workspaces, restoredSurfaceTabs });
    expect(applies([{ defaultView: true }])).toBe(true);
    expect(applies([])).toBe(true);
    expect(applies([{ defaultView: true }, {}])).toBe(false);
    expect(applies([{}])).toBe(false);
    expect(applies([{ defaultView: true }], true)).toBe(false);
  });
});

// QA 2026-10-31 N21: a relaunch restores the tabs but never the layers, so
// the restored views opened empty with "MNI anatomy at start" on.
describe('first screen after a restored launch', () => {
  it('targets the front volume view while nothing is loaded', () => {
    expect(restoredLaunchFirstScreenTarget({ id: WORKSPACE, type: 'orthogonal-flexible' })).toBe(
      WORKSPACE,
    );
    expect(restoredLaunchFirstScreenTarget({ id: 'm', type: 'mosaic' })).toBe('m');
  });

  it('never targets a tool tab, or a launch with layers already loaded', () => {
    expect(restoredLaunchFirstScreenTarget({ id: 's', type: 'set-studio' as never })).toBeNull();
    expect(restoredLaunchFirstScreenTarget({ id: 'b', type: 'bids-explorer' as never })).toBeNull();
    expect(restoredLaunchFirstScreenTarget(undefined)).toBeNull();
    setLayers(['zstat1.nii.gz']);
    expect(restoredLaunchFirstScreenTarget({ id: WORKSPACE, type: 'orthogonal-flexible' })).toBeNull();
  });

  it('shows the T1 in the restored Orthogonal tab', async () => {
    const target = restoredLaunchFirstScreenTarget({ id: WORKSPACE, type: 'orthogonal-flexible' });
    const backend = makeBackend(['MNI152NLin2009cAsym_T1w_1mm']);
    await expect(runFirstScreen(target!, backend)).resolves.toBe('shown');
    expect(layerIds()).toEqual(['layer-MNI152NLin2009cAsym_T1w_1mm']);
  });

  it('never targets a launch with a surface loaded', () => {
    useSurfaceStore.setState({ surfaces: new Map([['s1', {} as never]]) });
    try {
      expect(restoredLaunchFirstScreenTarget({ id: WORKSPACE, type: 'orthogonal-flexible' })).toBeNull();
    } finally {
      useSurfaceStore.setState({ surfaces: new Map() });
    }
  });

  it('does not load the T1 when another tab came to the front during the fetch', async () => {
    useWorkspaceStore.setState({
      workspaces: new Map([
        [WORKSPACE, { id: WORKSPACE, type: 'orthogonal-flexible' } as never],
        ['studio', { id: 'studio', type: 'set-studio' } as never],
      ]),
    });
    const backend = makeBackend([]);
    backend.cacheTemplate = vi.fn(async () => {
      useWorkspaceStore.setState({ activeWorkspaceId: 'studio' });
      return true;
    });
    await expect(runFirstScreen(WORKSPACE, backend)).resolves.toBe('superseded');
    expect(backend.loadTemplate).not.toHaveBeenCalled();
  });

  it('stays off when the setting is off', async () => {
    useLayoutSettingsStore.getState().setFirstScreenTemplate(false);
    const target = restoredLaunchFirstScreenTarget({ id: WORKSPACE, type: 'orthogonal-flexible' });
    await expect(runFirstScreen(target!, makeBackend(['MNI152NLin2009cAsym_T1w_1mm']))).resolves.toBe(
      'skipped',
    );
    expect(layerIds()).toEqual([]);
  });
});
