import { afterEach, describe, expect, it } from 'vitest';

import {
  FOCUSED_STACK_CLASS,
  ensureFocusedStack,
  focusCentreStackAfterLoad,
  installStackFocusTracker,
} from '../glStackFocus';

function buildLayout() {
  const root = document.createElement('div');
  const stacks = ['left', 'center', 'right'].map((name) => {
    const stack = document.createElement('div');
    stack.className = 'lm_stack';
    stack.dataset.name = name;
    const content = document.createElement('button');
    content.textContent = name;
    stack.appendChild(content);
    root.appendChild(stack);
    return stack;
  });
  document.body.appendChild(root);
  return { root, stacks };
}

const focusedNames = (root: HTMLElement) =>
  Array.from(root.querySelectorAll(`.${FOCUSED_STACK_CLASS}`)).map(
    (el) => (el as HTMLElement).dataset.name,
  );

describe('glStackFocus', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('marks the default stack on install and moves focus on pointerdown/focusin', () => {
    const { root, stacks } = buildLayout();
    const cleanup = installStackFocusTracker(root, () => stacks[1]);
    expect(focusedNames(root)).toEqual(['center']);

    stacks[0].firstElementChild!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(focusedNames(root)).toEqual(['left']);

    (stacks[2].firstElementChild as HTMLElement).focus();
    expect(focusedNames(root)).toEqual(['right']);

    cleanup();
    stacks[0].firstElementChild!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(focusedNames(root)).toEqual(['right']);
  });

  it('ignores events outside any stack', () => {
    const { root, stacks } = buildLayout();
    installStackFocusTracker(root, () => stacks[1]);
    root.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(focusedNames(root)).toEqual(['center']);
  });

  it('falls back to the default when the focused stack leaves the DOM', () => {
    const { root, stacks } = buildLayout();
    installStackFocusTracker(root, () => stacks[1]);
    stacks[0].firstElementChild!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    stacks[0].remove();
    ensureFocusedStack(root, () => stacks[1]);
    expect(focusedNames(root)).toEqual(['center']);
  });

  describe('focusCentreStackAfterLoad', () => {
    function withTree(stack: HTMLElement) {
      const container = document.createElement('div');
      const tree = document.createElement('div');
      tree.setAttribute('role', 'tree');
      const row = document.createElement('div');
      row.setAttribute('role', 'treeitem');
      row.tabIndex = -1;
      tree.appendChild(row);
      container.appendChild(tree);
      stack.appendChild(container);
      return { container, row };
    }

    it('releases a pointer-parked tree row and marks the centre stack', () => {
      const { root, stacks } = buildLayout();
      const cleanup = installStackFocusTracker(root, () => stacks[1]);
      const { row } = withTree(stacks[0]);
      row.focus();
      expect(focusedNames(root)).toEqual(['left']);

      focusCentreStackAfterLoad(root, () => stacks[1]);
      expect(document.activeElement).toBe(document.body);
      expect(focusedNames(root)).toEqual(['center']);
      cleanup();
    });

    it('leaves a keyboard-navigated tree focused', () => {
      const { root, stacks } = buildLayout();
      const cleanup = installStackFocusTracker(root, () => stacks[1]);
      const { container, row } = withTree(stacks[0]);
      container.setAttribute('data-kbd-nav', 'true');
      row.focus();

      focusCentreStackAfterLoad(root, () => stacks[1]);
      expect(document.activeElement).toBe(row);
      expect(focusedNames(root)).toEqual(['left']);
      cleanup();
    });

    it('does not take focus from other controls', () => {
      const { root, stacks } = buildLayout();
      const cleanup = installStackFocusTracker(root, () => stacks[1]);
      const button = stacks[2].firstElementChild as HTMLElement;
      button.focus();

      focusCentreStackAfterLoad(root, () => stacks[1]);
      expect(document.activeElement).toBe(button);
      expect(focusedNames(root)).toEqual(['right']);
      cleanup();
    });

    it('marks the centre stack when nothing has focus', () => {
      const { root, stacks } = buildLayout();
      const cleanup = installStackFocusTracker(root, () => stacks[1]);
      stacks[0].firstElementChild!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      expect(focusedNames(root)).toEqual(['left']);

      focusCentreStackAfterLoad(root, () => stacks[1]);
      expect(focusedNames(root)).toEqual(['center']);
      cleanup();
    });
  });
});
