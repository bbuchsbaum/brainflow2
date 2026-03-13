import { describe, expect, it } from 'vitest';
import {
  buildSurfaceViewContextId,
  buildSurfaceViewExporterKey,
  findSurfaceHandleForViewId,
  findSurfaceViewIdForSurface,
  parseSurfaceViewContextId,
  resolveActiveSurfaceSelection,
  resolveActiveSurfaceViewId,
  resolveBoundSurfaceHandle,
  resolveExplicitSurfaceViewId,
  resolveScopedSurfaceViewIdForSurface,
  resolveSurfaceViewState,
  resolveSurfaceViewIdFromPanelState,
} from '@/utils/surfaceViewContext';

describe('surfaceViewContext', () => {
  it('builds and parses stable surface view context ids', () => {
    const contextId = buildSurfaceViewContextId('Surface-ABC', 'View-123');

    expect(contextId).toBe('surfaceview:surface-abc:view-123');
    expect(parseSurfaceViewContextId(contextId)).toEqual({
      surfaceHandle: 'surface-abc',
      surfaceViewId: 'view-123',
    });
  });

  it('rejects legacy or malformed ids', () => {
    expect(parseSurfaceViewContextId('surfaceview:surface-only')).toBeNull();
    expect(parseSurfaceViewContextId('axial')).toBeNull();
    expect(parseSurfaceViewContextId(null)).toBeNull();
  });

  it('finds the first registered surface view id for a surface handle', () => {
    const bindings = new Map<string, string>([
      ['view-1', 'surface-a'],
      ['view-2', 'surface-b'],
    ]);

    expect(findSurfaceViewIdForSurface(bindings, 'surface-b')).toBe('view-2');
    expect(findSurfaceViewIdForSurface(bindings, 'missing')).toBeNull();
  });

  it('finds the bound surface handle for a view id', () => {
    const bindings = new Map<string, string>([
      ['view-1', 'surface-a'],
      ['view-2', 'surface-b'],
    ]);

    expect(findSurfaceHandleForViewId(bindings, 'view-1')).toBe('surface-a');
    expect(findSurfaceHandleForViewId(bindings, 'missing')).toBeNull();
  });

  it('prefers the registered surface binding over a stale fallback handle', () => {
    const bindings = new Map<string, string>([['view-a', 'surface-a']]);

    expect(resolveBoundSurfaceHandle('view-a', bindings, 'surface-b')).toBe('surface-a');
    expect(resolveBoundSurfaceHandle('view-missing', bindings, 'surface-b')).toBe('surface-b');
  });

  it('only scopes selection to an explicit view when the target matches the bound surface', () => {
    const bindings = new Map<string, string>([
      ['view-a', 'surface-a'],
      ['view-b', 'surface-b'],
    ]);

    expect(resolveScopedSurfaceViewIdForSurface('view-a', 'surface-a', bindings)).toBe('view-a');
    expect(resolveScopedSurfaceViewIdForSurface('view-a', 'surface-b', bindings)).toBeNull();
    expect(resolveScopedSurfaceViewIdForSurface(null, 'surface-a', bindings)).toBeNull();
  });

  it('resolves explicit surface view state with separate bound and selected roles', () => {
    const bindings = new Map<string, string>([['view-a', 'surface-a']]);
    const selections = new Map([
      ['view-a', {
        activeSurfaceId: 'surface-a',
        selectedItemType: 'dataLayer' as const,
        selectedLayerId: 'layer-a',
      }],
    ]);

    expect(resolveSurfaceViewState('view-a', bindings, selections)).toEqual({
      surfaceViewId: 'view-a',
      boundSurfaceId: 'surface-a',
      activeSurfaceId: 'surface-a',
      selectedItemType: 'dataLayer',
      selectedLayerId: 'layer-a',
      renderAnchorSurfaceId: 'surface-a',
    });
  });

  it('uses the last active renderable when there is no focused surface panel', () => {
    const bindings = new Map<string, string>([
      ['view-a', 'surface-a'],
      ['view-b', 'surface-b'],
    ]);

    expect(
      resolveActiveSurfaceViewId({
        activeSurfaceId: 'surface-a',
        surfaceViewHandles: bindings,
        activeRenderableId: 'surfaceview:surface-a:view-a',
      })
    ).toBe('view-a');
  });

  it('lets the active render context win even when global active surface points elsewhere', () => {
    const bindings = new Map<string, string>([
      ['view-a', 'surface-a'],
      ['view-b', 'surface-b'],
    ]);

    expect(
      resolveActiveSurfaceViewId({
        activeSurfaceId: 'surface-b',
        surfaceViewHandles: bindings,
        activeRenderableId: 'surfaceview:surface-a:view-a',
      })
    ).toBe('view-a');
  });

  it('prefers the focused surface panel when it disagrees with the last renderable', () => {
    const bindings = new Map<string, string>([
      ['view-a', 'surface-a'],
      ['view-b', 'surface-b'],
    ]);

    expect(
      resolveActiveSurfaceViewId({
        activeSurfaceId: 'surface-b',
        surfaceViewHandles: bindings,
        activeRenderableId: 'surfaceview:surface-a:view-a',
        activePanelType: 'SurfaceView',
        activePanelState: {
          surfaceViewId: 'view-b',
          surfaceHandle: 'surface-b',
        },
      })
    ).toBe('view-b');
  });

  it('resolves explicit surface context without falling back to an unrelated bound surface', () => {
    const bindings = new Map<string, string>([
      ['view-a', 'surface-a'],
      ['view-b', 'surface-b'],
    ]);

    expect(
      resolveExplicitSurfaceViewId({
        surfaceViewHandles: bindings,
        activePanelType: 'LayerPanel',
        activePanelState: {},
        activeRenderableId: null,
      })
    ).toBeNull();
  });

  it('prefers the focused surface panel over a stale compatibility active surface', () => {
    const bindings = new Map<string, string>([
      ['view-a', 'surface-a'],
      ['view-b', 'surface-b'],
    ]);

    expect(
      resolveActiveSurfaceViewId({
        activeSurfaceId: 'surface-a',
        surfaceViewHandles: bindings,
        activePanelType: 'SurfaceView',
        activePanelState: {
          surfaceViewId: 'view-b',
          surfaceHandle: 'surface-b',
        },
      })
    ).toBe('view-b');
  });

  it('builds a surface exporter key from component state and registered handles', () => {
    const bindings = new Map<string, string>([['view-a', 'surface-a']]);

    expect(
      buildSurfaceViewExporterKey(
        'SurfaceView',
        { surfaceViewId: 'view-a' },
        bindings
      )
    ).toBe('surfaceview:surface-a:view-a');
  });

  it('builds an exporter key from the registered binding when panel state has a stale surface handle', () => {
    const bindings = new Map<string, string>([['view-a', 'surface-a']]);

    expect(
      buildSurfaceViewExporterKey(
        'SurfaceView',
        { surfaceViewId: 'view-a', surfaceHandle: 'surface-stale' },
        bindings
      )
    ).toBe('surfaceview:surface-a:view-a');
  });

  it('rejects panel surface view ids that do not match the active surface', () => {
    const bindings = new Map<string, string>([['view-a', 'surface-a']]);

    expect(
      resolveSurfaceViewIdFromPanelState(
        'SurfaceView',
        { surfaceViewId: 'view-a', surfaceHandle: 'surface-a' },
        bindings,
        'surface-b'
      )
    ).toBeNull();
  });

  it('resolves scoped surface selection from the focused surface view before global compatibility state', () => {
    const bindings = new Map<string, string>([
      ['view-a', 'surface-a'],
      ['view-b', 'surface-b'],
    ]);
    const selections = new Map([
      ['view-a', {
        activeSurfaceId: 'surface-a',
        selectedItemType: 'geometry' as const,
        selectedLayerId: null,
      }],
      ['view-b', {
        activeSurfaceId: 'surface-b',
        selectedItemType: 'dataLayer' as const,
        selectedLayerId: 'layer-b',
      }],
    ]);

    expect(
      resolveActiveSurfaceSelection({
        activeSurfaceId: 'surface-a',
        selectedItemType: 'geometry',
        selectedLayerId: null,
        surfaceViewHandles: bindings,
        surfaceViewSelections: selections,
        activePanelType: 'SurfaceView',
        activePanelState: {
          surfaceViewId: 'view-b',
          surfaceHandle: 'surface-b',
        },
      })
    ).toEqual({
      surfaceViewId: 'view-b',
      activeSurfaceId: 'surface-b',
      selectedItemType: 'dataLayer',
      selectedLayerId: 'layer-b',
    });
  });
});
