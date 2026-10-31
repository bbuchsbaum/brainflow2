import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/apiService', () => ({ getApiService: () => ({}) }));

import { chooseScaleBarCorner, coverageOf } from '../compositeExport';
import { baseColorbarLayerId } from '../compositeCapture';
import { resolveColorbarLayer } from '@/components/views/viewportFrame/useOverlayColorbar';

describe('scale bar placement clear of data (native R2-4)', () => {
  it('takes the first corner clear of letters and data, else the corner with the least data', () => {
    // Crop to brain: a blob under the bottom-right corner.
    expect(
      chooseScaleBarCorner([
        { corner: 'bottom-right', lettersClear: true, coverage: 0.4 },
        { corner: 'bottom-left', lettersClear: true, coverage: 0 },
        { corner: 'top-right', lettersClear: true, coverage: 0 },
        { corner: 'top-left', lettersClear: true, coverage: 0 },
      ]),
    ).toBe('bottom-left');
    // Data everywhere: the least-covered corner, never one over a letter.
    expect(
      chooseScaleBarCorner([
        { corner: 'bottom-right', lettersClear: true, coverage: 0.5 },
        { corner: 'bottom-left', lettersClear: false, coverage: 0 },
        { corner: 'top-right', lettersClear: true, coverage: 0.1 },
        { corner: 'top-left', lettersClear: true, coverage: 0.3 },
      ]),
    ).toBe('top-right');
    // An empty corner keeps the default.
    expect(chooseScaleBarCorner([{ corner: 'bottom-right', lettersClear: true, coverage: 0 }])).toBe('bottom-right');
  });

  it('counts data pixels against the page: black, white and transparent', () => {
    const px = (...rgba: number[]) => Uint8ClampedArray.from(rgba);
    // Half the pixels are data (a mid-grey) on a black page.
    expect(coverageOf(px(0, 0, 0, 255, 128, 128, 128, 255), 'black')).toBe(0.5);
    // White page: white is page, a dark pixel is data.
    expect(coverageOf(px(255, 255, 255, 255, 20, 20, 20, 255), 'white')).toBe(0.5);
    // Transparent page: transparent is page.
    expect(coverageOf(px(200, 200, 200, 0, 200, 200, 200, 255), 'transparent')).toBe(0.5);
  });
});

describe('a statistic loaded as the base layer gets the export colorbar (native R2-4)', () => {
  const view = (id: string, colormap: string) => ({
    id,
    name: id,
    volumeId: id,
    visible: true,
    opacity: 1,
    colormap,
    intensity: [-6, 6] as [number, number],
    threshold: [-3.1, 3.1] as [number, number],
  });
  const zStat = { kind: 'z', intentCode: 5, intentParams: [0, 0, 0], label: 'z', positiveDataLabel: null } as never;

  it('the base z map (no overlay) is the colorbar layer, drawn with the base allowed', () => {
    const layers = [{ id: 'z', name: 'fir_zmap', volumeId: 'z', type: 'volume', visible: true, statistic: zStat }] as never;
    const meta = new Map([['z', { dataRange: { min: -5, max: 6 } }]]) as never;
    const id = baseColorbarLayerId(layers, [view('z', 'fmri')] as never, meta);
    expect(id).toBe('z');
    // The frame's own rule still refuses the base; the export passes allowBase.
    expect(resolveColorbarLayer(layers, 'z', view('z', 'fmri') as never, true)).toBeNull();
    expect(resolveColorbarLayer(layers, 'z', view('z', 'fmri') as never, true, null, { allowBase: true })).toMatchObject({
      layerId: 'z',
      colormap: 'fmri',
    });
  });

  it('a plain grey anatomical base gets none', () => {
    const layers = [{ id: 't1', name: 'T1', volumeId: 't1', type: 'volume', visible: true }] as never;
    const meta = new Map([['t1', { dataRange: { min: 0, max: 900 } }]]) as never;
    expect(baseColorbarLayerId(layers, [view('t1', 'gray')] as never, meta)).toBeNull();
  });
});

import { availableExportTargets, defaultExportTarget, registerMosaicExportSource, resetExportFocusRecency } from '../compositeCapture';
import { useActiveRenderContextStore } from '@/stores/activeRenderContextStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useViewStateStore } from '@/stores/viewStateStore';

describe('the export target follows the focused view (native R2-5)', () => {
  it('a Mosaic tab left open does not capture the export once another view is focused; switching back to it does', () => {
    resetExportFocusRecency();
    useViewStateStore.getState().setViewState((state) => {
      state.layers = [
        { id: 't1', name: 't1', volumeId: 't1', visible: true, opacity: 1, colormap: 'gray', intensity: [0, 1], threshold: [0, 0] },
      ] as never;
    });
    const unregister = registerMosaicExportSource('mosaic-ws', () => ({ workspaceId: 'mosaic-ws', axis: 'axial', cols: 4, tiles: [] }));
    useWorkspaceStore.setState({
      workspaces: new Map([
        ['mosaic-ws', { id: 'mosaic-ws', type: 'mosaic' }],
        ['other', { id: 'other', type: 'orthogonal' }],
      ]),
      activeWorkspaceId: 'mosaic-ws',
    } as never);
    expect(availableExportTargets()).toEqual(['mosaic']);
    // The user clicks the axial view (another tab's canvas): that view is the target.
    useActiveRenderContextStore.getState().setActive('axial');
    expect(availableExportTargets()).not.toContain('mosaic');
    expect(defaultExportTarget()).toBe('axial');
    // Back to the Mosaic tab: the workspace switch is newer than the focus.
    useWorkspaceStore.setState({ activeWorkspaceId: 'other' } as never);
    useWorkspaceStore.setState({ activeWorkspaceId: 'mosaic-ws' } as never);
    expect(availableExportTargets()).toEqual(['mosaic']);
    unregister();
  });
});

describe('Export from a tab switched to Mosaic in place (QA 2026-10-30 F26)', () => {
  it('defaults to the mosaic, not the slice view focused before the switch', () => {
    resetExportFocusRecency();
    useViewStateStore.getState().setViewState((state) => {
      state.layers = [
        { id: 't1', name: 't1', volumeId: 't1', visible: true, opacity: 1, colormap: 'gray', intensity: [0, 1], threshold: [0, 0] },
      ] as never;
    });
    useWorkspaceStore.setState({
      workspaces: new Map([['ws', { id: 'ws', type: 'orthogonal' }]]),
      activeWorkspaceId: 'ws',
    } as never);
    useActiveRenderContextStore.getState().setActive('sagittal');
    expect(defaultExportTarget()).toBe('sagittal');
    // The layout pill turns the same tab into a mosaic: no workspace switch.
    const unregister = registerMosaicExportSource('ws', () => ({ workspaceId: 'ws', axis: 'axial', cols: 4, tiles: [] }));
    expect(defaultExportTarget()).toBe('mosaic');
    unregister();
    // Mosaic not exportable (gone, or not ready): axial, not the stale sagittal.
    expect(defaultExportTarget()).toBe('axial');
  });
});
