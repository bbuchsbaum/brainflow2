/**
 * qa-features-2026-10-31 §9 (QA 2026-10-30 F15): surface tabs come back on
 * relaunch as placeholders, described by their sources.
 */
import { describe, expect, it } from 'vitest';
import type { ContentItem } from 'golden-layout';

import {
  SURFACE_PLACEHOLDER_COMPONENT,
  describeSurfaceTabs,
  PendingTabOrder,
  placeholderItemConfig,
  surfaceSourceFromPath,
} from '../surfaceTabRestore';
import type { SavedSurfaceTab } from '@/stores/surfaceTabRestoreStore';

const tab = (componentType: string, title: string, state: Record<string, unknown>) => ({
  type: 'component',
  componentType,
  title,
  container: { initialState: state },
  contentItems: [],
});
const tree = (...children: unknown[]) =>
  ({ type: 'row', contentItems: [{ type: 'stack', contentItems: children }] }) as unknown as ContentItem;

describe('surface tab restore', () => {
  it('reads a template or a file source from a surface path', () => {
    expect(surfaceSourceFromPath('templateflow://fsaverage5_pial_left')).toEqual({
      kind: 'template',
      path: 'templateflow://fsaverage5_pial_left',
      space: 'fsaverage5',
      geometryType: 'pial',
      hemisphere: 'left',
    });
    expect(surfaceSourceFromPath('/data/sub-01/lh.white.gii')).toEqual({
      kind: 'file',
      path: '/data/sub-01/lh.white.gii',
    });
    expect(surfaceSourceFromPath('blob://x')).toBeNull();
    expect(surfaceSourceFromPath('')).toBeNull();
  });

  it('describes each surface tab with every surface of its scene', () => {
    const surfaces = [
      { handle: 'L', metadata: { path: 'templateflow://fsaverage5_pial_left' } },
      { handle: 'R', metadata: { path: 'templateflow://fsaverage5_pial_right' } },
      { handle: 'W', metadata: { path: 'templateflow://fsaverage5_white_left' } },
    ];
    const root = tree(
      tab('Workspace', 'Mosaic', { workspaceId: 'w1' }),
      tab('surfaceView', 'fsaverage5_pial_left', {
        surfaceHandle: 'L',
        path: 'templateflow://fsaverage5_pial_left',
        groupKey: 'templateflow://fsaverage5_pial',
        surfaceViewId: 'sv-pial',
      }),
      tab('surfaceView', 'fsaverage5_white_left', {
        surfaceHandle: 'W',
        path: 'templateflow://fsaverage5_white_left',
        groupKey: 'templateflow://fsaverage5_white',
        surfaceViewId: 'sv-white',
      }),
    );

    const tabs = describeSurfaceTabs(root, surfaces);
    expect(tabs.map((t) => [t.surfaceViewId, t.title, t.sources.map((s) => s.path)])).toEqual([
      [
        'sv-pial',
        'fsaverage5_pial_left',
        ['templateflow://fsaverage5_pial_left', 'templateflow://fsaverage5_pial_right'],
      ],
      ['sv-white', 'fsaverage5_white_left', ['templateflow://fsaverage5_white_left']],
    ]);
  });

  it('keeps a placeholder that was not reloaded for the next launch', () => {
    const saved: SavedSurfaceTab = {
      surfaceViewId: 'sv-1',
      title: 'lh.white.gii',
      sources: [{ kind: 'file', path: '/data/lh.white.gii' }],
    };
    const config = placeholderItemConfig(saved);
    expect(config.componentType).toBe(SURFACE_PLACEHOLDER_COMPONENT);
    expect(config.title).toBe('lh.white.gii');

    const root = tree(tab(SURFACE_PLACEHOLDER_COMPONENT, saved.title, { saved }));
    expect(describeSurfaceTabs(root, [])).toEqual([saved]);
  });

  it('falls back to the tab path when its surface is no longer loaded', () => {
    const root = tree(
      tab('surfaceView', 'rh.pial.gii', { surfaceHandle: 'gone', path: '/d/rh.pial.gii', surfaceViewId: 'sv' }),
    );
    expect(describeSurfaceTabs(root, [])[0].sources).toEqual([{ kind: 'file', path: '/d/rh.pial.gii' }]);
  });

  // Review L5: a restored tab that fails to add must not freeze the saved
  // order for the whole session.
  it('the pending relaunch order ends when finished, or after its window', () => {
    let t = 0;
    const pending = new PendingTabOrder(['ws:a', 'sv:b'], 1000, () => t);
    expect(pending.current()).toEqual(['ws:a', 'sv:b']);
    t = 1001;
    expect(pending.current()).toBeNull();

    const finished = new PendingTabOrder(['ws:a'], 1000, () => 0);
    finished.finish();
    expect(finished.current()).toBeNull();
  });
});
