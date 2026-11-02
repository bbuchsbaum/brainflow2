import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BIDS_FINDINGS_PANEL,
  createDefaultLayoutConfig,
  findComponentItemsByType,
  getLayoutService,
} from '../layoutService';

/** A workspace-scoped tab: added by its workspace, never restored from a saved layout. */

interface Item {
  type: string;
  componentType?: string;
  title?: string;
  container?: { initialState: Record<string, unknown> };
  contentItems: Item[];
  parent: Item | null;
  remove?: () => void;
  setTitle?: (title: string) => void;
  addItem?: (config: { componentType: string; title?: string }) => number;
  addChild?: (item: Item) => void;
  setActiveComponentItem?: ReturnType<typeof vi.fn>;
  getActiveComponentItem?: () => Item | undefined;
}

function component(componentType: string): Item {
  const item: Item = {
    type: 'component',
    componentType,
    title: componentType,
    container: { initialState: {} },
    contentItems: [],
    parent: null,
    remove: () => {
      const siblings = item.parent!.contentItems;
      siblings.splice(siblings.indexOf(item), 1);
    },
    setTitle: (title) => {
      item.title = title;
    },
  };
  return item;
}

function makeLayout() {
  const files = component('FileBrowser');
  const left: Item = {
    type: 'stack',
    contentItems: [files],
    parent: null,
    setActiveComponentItem: vi.fn(),
    getActiveComponentItem: () => files,
  };
  files.parent = left;
  left.addChild = (item) => {
    item.parent = left;
    left.contentItems.push(item);
  };
  left.addItem = (config) => {
    const item = component(config.componentType);
    item.title = config.title;
    left.addChild!(item);
    return left.contentItems.length - 1;
  };
  const column = (child: Item): Item => ({ type: 'column', contentItems: [child], parent: null });
  const center: Item = { type: 'stack', contentItems: [], parent: null };
  const right: Item = { type: 'stack', contentItems: [], parent: null };
  const layout = {
    rootItem: { type: 'row', contentItems: [column(left), center, column(right)], parent: null },
    loadLayout: vi.fn(),
    newItem: vi.fn(),
  };
  return { layout, left, files };
}

const tabs = (layout: { rootItem: unknown }) =>
  findComponentItemsByType(layout.rootItem as never, BIDS_FINDINGS_PANEL);

describe('scoped panel', () => {
  let fixture: ReturnType<typeof makeLayout>;

  beforeEach(() => {
    fixture = makeLayout();
    getLayoutService().setLayoutRef(fixture.layout);
  });

  afterEach(() => {
    getLayoutService().setScopedPanel(null);
  });

  it('adds one tab beside Files, keeps Files in front, removes it on leaving', () => {
    const service = getLayoutService();
    service.setScopedPanel(BIDS_FINDINGS_PANEL);
    service.setScopedPanel(BIDS_FINDINGS_PANEL);
    expect(tabs(fixture.layout)).toHaveLength(1);
    expect(tabs(fixture.layout)[0].title).toBe('Findings');
    expect(fixture.left.setActiveComponentItem).toHaveBeenLastCalledWith(fixture.files, true);
    service.setPanelTitle(BIDS_FINDINGS_PANEL, 'Findings 19');
    expect(tabs(fixture.layout)[0].title).toBe('Findings 19');
    service.setScopedPanel(null);
    expect(tabs(fixture.layout)).toHaveLength(0);
    expect(fixture.left.contentItems).toEqual([fixture.files]);
  });

  it('returns to Files when the tab was in front on leaving', () => {
    const service = getLayoutService();
    service.setScopedPanel(BIDS_FINDINGS_PANEL);
    fixture.left.getActiveComponentItem = () => tabs(fixture.layout)[0];
    fixture.left.setActiveComponentItem!.mockClear();
    service.setScopedPanel(null);
    expect(fixture.left.setActiveComponentItem).toHaveBeenCalledWith(fixture.files, true);
  });

  it('leaves the stack alone when another tab was in front on leaving', () => {
    const service = getLayoutService();
    service.setScopedPanel(BIDS_FINDINGS_PANEL);
    fixture.left.setActiveComponentItem!.mockClear();
    service.setScopedPanel(null);
    expect(fixture.left.setActiveComponentItem).not.toHaveBeenCalled();
  });

  it('never comes back from a saved layout', () => {
    const config = createDefaultLayoutConfig();
    const stack = (config.root as { content: Array<{ content: Array<{ content: unknown[] }> }> })
      .content[0].content[0];
    stack.content.push({ type: 'component', componentType: BIDS_FINDINGS_PANEL, title: 'Findings 19', componentState: {} });
    expect(getLayoutService().applyLayout(config)).toBe('applied');
    const [loaded] = fixture.layout.loadLayout.mock.calls[0];
    expect(JSON.stringify(loaded)).not.toContain(BIDS_FINDINGS_PANEL);
    expect(tabs(fixture.layout)).toHaveLength(0);
  });

  it('returns after a layout load while its workspace is in front', () => {
    const service = getLayoutService();
    service.setScopedPanel(BIDS_FINDINGS_PANEL);
    tabs(fixture.layout)[0].remove();
    expect(service.applyLayout(createDefaultLayoutConfig())).toBe('applied');
    expect(tabs(fixture.layout)).toHaveLength(1);
  });
});
