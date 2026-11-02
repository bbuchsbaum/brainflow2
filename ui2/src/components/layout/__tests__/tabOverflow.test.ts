/**
 * The left stack at its default width (about 180 px) cannot fit Files, Subjects
 * and Findings N. GoldenLayout moves what does not fit to a list that only its
 * tab-dropdown button opens, so with that button off the tabs were unreachable.
 * Real GoldenLayout; jsdom has no layout, so the widths are stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoldenLayout, type ComponentItem, type Stack } from 'golden-layout';

import {
  BIDS_FINDINGS_PANEL,
  createDefaultLayoutConfig,
  findComponentItemsByType,
  getLayoutService,
} from '@/services/layoutService';

const HEADER_WIDTH = 180;
const TAB_WIDTH = 90;

let layout: GoldenLayout | null = null;
let host: HTMLDivElement | null = null;
let margins: HTMLStyleElement | null = null;

const leftStack = (gl: GoldenLayout) =>
  findComponentItemsByType(gl.rootItem, 'FileBrowser')[0].parent as Stack;
const header = (stack: Stack) => stack.element.querySelector('.lm_header') as HTMLElement;
const dropdownButton = (stack: Stack) => header(stack).querySelector<HTMLElement>('.lm_tabdropdown');
const titles = (stack: Stack, list: string) =>
  [...header(stack).querySelectorAll<HTMLElement>(`${list} .lm_title`)].map((title) => title.innerText);

function mount(): GoldenLayout {
  host = document.createElement('div');
  document.body.appendChild(host);
  const gl = new GoldenLayout(host);
  layout = gl;
  for (const type of ['FileBrowser', 'StudioDesignPanel', 'Inspector', BIDS_FINDINGS_PANEL]) {
    gl.registerComponent(type, () => {});
  }
  gl.loadLayout(createDefaultLayoutConfig());
  getLayoutService().setLayoutRef(gl);
  return gl;
}

describe('a stack too narrow for its tabs', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    // GoldenLayout adds each tab's computed margin; jsdom has none without a rule.
    margins = document.createElement('style');
    margins.textContent = '.lm_tab { margin-right: 0px; }';
    document.head.appendChild(margins);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.classList.contains('lm_tab')) return TAB_WIDTH;
      if (this.classList.contains('lm_header')) return HEADER_WIDTH;
      return 0;
    });
  });

  afterEach(() => {
    getLayoutService().setScopedPanel(null);
    getLayoutService().setLayoutRef(null);
    layout?.destroy();
    layout = null;
    host?.remove();
    host = null;
    margins?.remove();
    margins = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows the button that opens the tabs that did not fit', () => {
    const gl = mount();
    getLayoutService().setScopedPanel(BIDS_FINDINGS_PANEL);
    const stack = leftStack(gl);

    expect(titles(stack, '.lm_tabs')).toEqual(['Files']);
    expect(titles(stack, '.lm_tabdropdown_list').sort()).toEqual(['Findings', 'Subjects']);
    const button = dropdownButton(stack);
    expect(button).not.toBeNull();
    expect(button!.style.display).not.toBe('none');
    expect(button!.title).toBe('More tabs');

    const list = header(stack).querySelector('.lm_tabdropdown_list') as HTMLElement;
    expect(list.style.display).toBe('none');
    button!.click();
    expect(list.style.display).toBe('');
  });

  it('keeps the button hidden in a stack whose tabs fit', () => {
    const gl = mount();
    const inspector = findComponentItemsByType(gl.rootItem, 'Inspector')[0].parent as Stack;
    expect(dropdownButton(inspector)?.style.display).toBe('none');
  });

  it('brings a tab out of the list when asked for it, in front and on the strip', () => {
    const gl = mount();
    const service = getLayoutService();
    service.setScopedPanel(BIDS_FINDINGS_PANEL);
    const stack = leftStack(gl);
    expect(service.showPanel(BIDS_FINDINGS_PANEL)).toBe(true);
    const [findings] = findComponentItemsByType(gl.rootItem, BIDS_FINDINGS_PANEL) as ComponentItem[];
    expect(stack.getActiveComponentItem()).toBe(findings);
    expect(titles(stack, '.lm_tabs')).toContain('Findings');
  });

  it('turns the button on for a layout saved while it was off', () => {
    const gl = mount();
    const saved = createDefaultLayoutConfig();
    saved.header = { popout: false, tabDropdown: false };
    expect(getLayoutService().applyLayout(saved)).toBe('applied');
    getLayoutService().setScopedPanel(BIDS_FINDINGS_PANEL);
    const stack = leftStack(gl);
    expect(dropdownButton(stack)).not.toBeNull();
    expect(dropdownButton(stack)?.style.display).not.toBe('none');
  });
});
