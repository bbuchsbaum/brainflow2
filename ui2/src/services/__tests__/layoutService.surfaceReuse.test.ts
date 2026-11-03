import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLayoutService, surfacePairTitle } from '../layoutService';

/**
 * Module B — surfaceView placement reuse keyed on the scene group key.
 * Left/Right of the same template join one tab under the default `auto` intent;
 * `new-view` always mints a fresh tab; local (ungroupable) surfaces stay
 * one-tab-per-handle.
 */

interface FakeComponentItem {
  type: 'component';
  componentType: string;
  title: string;
  setTitle: (title: string) => void;
  container: { initialState: Record<string, unknown> };
}

interface FakeStack {
  type: 'stack';
  contentItems: FakeComponentItem[];
  addItem: ReturnType<typeof vi.fn>;
  setActiveComponentItem: ReturnType<typeof vi.fn>;
}

function makeLayout(): { layoutRef: unknown; stack: FakeStack } {
  const stack: FakeStack = {
    type: 'stack',
    contentItems: [],
    addItem: vi.fn(
      (config: { componentType: string; title: string; componentState: Record<string, unknown> }) => {
        const item: FakeComponentItem = {
          type: 'component',
          componentType: config.componentType,
          title: config.title,
          setTitle: (title: string) => {
            item.title = title;
          },
          container: { initialState: config.componentState },
        };
        stack.contentItems.push(item);
      },
    ),
    setActiveComponentItem: vi.fn(),
  };

  const layoutRef = {
    rootItem: {
      type: 'row',
      contentItems: [{ type: 'column' }, stack, { type: 'column' }],
    },
  };

  return { layoutRef, stack };
}

describe('layoutService.ensureSurfaceView — scene reuse', () => {
  let stack: FakeStack;

  beforeEach(() => {
    // addComponent defers via requestAnimationFrame; run it synchronously.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    const layout = makeLayout();
    stack = layout.stack;
    getLayoutService().setLayoutRef(layout.layoutRef);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('joins the existing tab when the second hemisphere shares a template group', () => {
    const layout = getLayoutService();
    layout.ensureSurfaceView(
      'surface_template_fsaverage_pial_L',
      'templateflow://fsaverage_pial_left',
    );
    expect(stack.contentItems).toHaveLength(1);
    expect(stack.contentItems[0].container.initialState.groupKey).toBe(
      'templateflow://fsaverage_pial',
    );

    layout.ensureSurfaceView(
      'surface_template_fsaverage_pial_R',
      'templateflow://fsaverage_pial_right',
    );
    expect(stack.contentItems).toHaveLength(1); // no duplicate tab
    expect(stack.setActiveComponentItem).toHaveBeenCalledWith(stack.contentItems[0], true);
  });

  it('retitles the tab after the pair when the other hemisphere joins (N47)', () => {
    const layout = getLayoutService();
    layout.ensureSurfaceView(
      'surface_template_fsaverage6_pial_L',
      'templateflow://fsaverage6_pial_left',
    );
    expect(stack.contentItems[0].title).toBe('fsaverage6_pial_left');

    // Reloading the same hemisphere keeps the single-hemisphere title.
    layout.ensureSurfaceView(
      'surface_template_fsaverage6_pial_L',
      'templateflow://fsaverage6_pial_left',
    );
    expect(stack.contentItems[0].title).toBe('fsaverage6_pial_left');

    layout.ensureSurfaceView(
      'surface_template_fsaverage6_pial_R',
      'templateflow://fsaverage6_pial_right',
    );
    expect(stack.contentItems).toHaveLength(1);
    expect(stack.contentItems[0].title).toBe('fsaverage6 pial');
  });

  it('names local and BIDS pairs without the hemisphere token', () => {
    expect(surfacePairTitle('templateflow://fsaverage6_pial')).toBe('fsaverage6 pial');
    expect(surfacePairTitle('/data/surf/hemi-pair.pial')).toBe('pial');
    expect(surfacePairTitle('/data/sub-01_hemi-pair_pial.surf.gii')).toBe('sub-01_pial.surf.gii');
  });

  it('mints a fresh tab when intent is new-view', () => {
    const layout = getLayoutService();
    layout.ensureSurfaceView(
      'surface_template_fsaverage_pial_L',
      'templateflow://fsaverage_pial_left',
    );
    layout.ensureSurfaceView(
      'surface_template_fsaverage_pial_R',
      'templateflow://fsaverage_pial_right',
      { intent: 'new-view' },
    );
    expect(stack.contentItems).toHaveLength(2);
  });

  it('keeps distinct geometries in separate tabs', () => {
    const layout = getLayoutService();
    layout.ensureSurfaceView(
      'surface_template_fsaverage_white_L',
      'templateflow://fsaverage_white_left',
    );
    layout.ensureSurfaceView(
      'surface_template_fsaverage_pial_L',
      'templateflow://fsaverage_pial_left',
    );
    expect(stack.contentItems).toHaveLength(2);
  });

  it('keeps local (ungroupable) surfaces one-tab-per-handle but reuses on reload', () => {
    const layout = getLayoutService();
    layout.ensureSurfaceView('local_a', '/data/a.gii');
    layout.ensureSurfaceView('local_b', '/data/b.gii');
    expect(stack.contentItems).toHaveLength(2);

    // Same handle reloads into its existing tab.
    layout.ensureSurfaceView('local_a', '/data/a.gii');
    expect(stack.contentItems).toHaveLength(2);
  });
});
