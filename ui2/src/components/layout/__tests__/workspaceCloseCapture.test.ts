import type { GoldenLayout } from 'golden-layout';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installWorkspaceCloseCapture } from '../workspaceCloseCapture';
import { installWorkspaceCloseGuard, removeWorkspaceCloseGuard } from '@/services/workspaceCloseGuards';

type Listener = (value: unknown) => void;
const makeItem = (id: string) => ({ type: 'component', container: { initialState: { workspaceId: id } } });

function setup() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const stack = { type: 'stack', element: document.createElement('div'), contentItems: [makeItem('moved')] };
  stack.element.className = 'lm_stack';
  root.appendChild(stack.element);
  const listeners = new Map<string, Listener>();
  const layout = {
    rootItem: { type: 'row', contentItems: [stack] },
    on: vi.fn((name: string, fn: Listener) => listeners.set(name, fn)),
    off: vi.fn(),
  };
  const request = vi.fn(async () => false);
  const cleanup = installWorkspaceCloseCapture(layout as unknown as GoldenLayout, root, request);
  const tab = document.createElement('div');
  tab.className = 'lm_tab';
  tab.innerHTML = '<button class="lm_close_tab">x</button>';
  stack.element.appendChild(tab);
  listeners.get('tabCreated')!({ componentItem: makeItem('moved'), element: tab });
  return { root, tab, stack, request, cleanup };
}

afterEach(() => { document.body.replaceChildren(); removeWorkspaceCloseGuard('moved'); });

describe('workspace close capture', () => {
  it('captures ×, touch/synthetic click, and both middle-click forms for a moved workspace tab', () => {
    const { tab, request, cleanup } = setup();
    const close = tab.querySelector('.lm_close_tab')!;
    close.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    close.dispatchEvent(new Event('touchstart', { bubbles: true, cancelable: true }));
    close.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    tab.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 1 }));
    tab.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
    expect(request).toHaveBeenCalledTimes(5);
    expect(request).toHaveBeenLastCalledWith('moved');
    cleanup();
  });

  it('blocks guarded group close with an explanation but leaves ordinary stacks alone', () => {
    const { stack, request, cleanup } = setup();
    const groupClose = document.createElement('button');
    groupClose.className = 'lm_close';
    stack.element.appendChild(groupClose);
    installWorkspaceCloseGuard('moved');
    const guarded = new MouseEvent('click', { bubbles: true, cancelable: true });
    groupClose.dispatchEvent(guarded);
    expect(guarded.defaultPrevented).toBe(true);
    expect(groupClose.title).toContain('individually');
    expect(request).not.toHaveBeenCalled();
    removeWorkspaceCloseGuard('moved');
    const ordinary = new MouseEvent('click', { bubbles: true, cancelable: true });
    groupClose.dispatchEvent(ordinary);
    expect(ordinary.defaultPrevented).toBe(false);
    cleanup();
  });
});
