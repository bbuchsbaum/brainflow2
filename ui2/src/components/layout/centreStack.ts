/**
 * The centre stack: the GoldenLayout stack that holds the view, tool and
 * surface tabs (the middle child of the root row, between Files and the
 * Inspector).
 *
 * GoldenLayout removes a closable stack when its last child goes, and the
 * stack header's × removes the stack with every tab in it. Either way the
 * window lost its centre: no default view could be added, the pills kept the
 * closed tab's state and only Reset Layout recovered (QA 2026-10-30 F1). So:
 *
 * - the centre stack is configured `isClosable: false`
 *   (`CENTRE_STACK_CONFIG`): no stack-level ×, and GoldenLayout keeps it when
 *   its last tab goes, so the side columns never take its width (QA
 *   2026-10-31: Files and Inspector stayed about 2× wide);
 * - tabs close one at a time with their own × (the last one brings back a
 *   default view). A non-closable stack refuses its last tab's ×, so that
 *   one click is handled here;
 * - when GoldenLayout drops the stack anyway (a layout from elsewhere),
 *   `ensureCentreStack` puts an empty one back in its place.
 */

import type { GoldenLayout, LayoutManager, Stack, StackItemConfig } from 'golden-layout';

/** Share of the root row the centre takes in the default shell (see layoutService). */
export const CENTRE_STACK_SIZE = '59.75%';

const CENTRE_MARK = 'bfCentreStack';
/** Files | Inspector shares of the default shell (createDefaultLayoutConfig). */
const SIDE_SIZES = [17.25, 23] as const;

/**
 * `LayoutManager.LocationSelector.TypeId.Root`: a child of the root item at
 * `index`. Spelled out because the enum is a `const enum`, which the bundler
 * cannot inline.
 */
const ROOT_LOCATION = 7 as LayoutManager.LocationSelector.TypeId.Root;

/** What makes a stack config the centre stack (default shell, saved layouts). */
export const CENTRE_STACK_FLAGS = { isClosable: false } as const;

/** The centre stack, or null when the root row has none in the middle. */
export function getCentreStack(layout: GoldenLayout | null | undefined): Stack | null {
  const root = layout?.rootItem;
  if (!root || root.type !== 'row') return null;
  const centre = root.contentItems[1];
  return centre?.type === 'stack' ? (centre as Stack) : null;
}

/**
 * A non-closable stack refuses to remove its last tab (GoldenLayout's header
 * allows it only when the stack is closable or has more tabs), so that tab's
 * × did nothing. Close it here, as GoldenLayout would: removing it from the
 * stack destroys it, and its destroy handler closes the workspace.
 */
function prepareCentreStack(stack: Stack): Stack {
  const element = stack.element as HTMLElement | undefined;
  if (!element || element.dataset[CENTRE_MARK] === 'true') return stack;
  element.dataset[CENTRE_MARK] = 'true';
  element.addEventListener(
    'click',
    (event) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('.lm_close_tab')) return;
      if (stack.contentItems.length !== 1) return; // GoldenLayout handles it
      const [only] = stack.contentItems;
      if (!only || !(only as { isClosable?: boolean }).isClosable) return;
      event.stopPropagation();
      only.remove();
    },
    true,
  );
  return stack;
}

/**
 * The centre stack, re-created (empty) when GoldenLayout removed it. Null only
 * when the layout has no root row to put it in.
 */
export function ensureCentreStack(layout: GoldenLayout | null | undefined): Stack | null {
  const existing = getCentreStack(layout);
  if (existing) return prepareCentreStack(existing);
  const root = layout?.rootItem;
  if (!layout || !root || root.type !== 'row') return null;
  // Only a missing centre is repaired; a row whose middle the user replaced
  // with another stack is left alone (getCentreStack already returned it).
  if (root.contentItems.some((item) => item.type === 'stack')) return null;

  const config: StackItemConfig = {
    type: 'stack',
    size: CENTRE_STACK_SIZE,
    content: [],
    ...CENTRE_STACK_FLAGS,
  };
  try {
    const index = Math.min(1, root.contentItems.length);
    layout.addItemAtLocation(config, [{ typeId: ROOT_LOCATION, index }]);
  } catch (error) {
    console.error('[centreStack] Failed to restore the centre stack:', error);
    return null;
  }
  const created = getCentreStack(layout);
  if (!created) return null;
  // Give the columns back their default shares (17.25 | 59.75 | 23).
  const [left, , right] = root.contentItems;
  if (left && right && root.contentItems.length === 3) {
    // `size` is public in GoldenLayout but left out of its release types.
    const sized = (item: unknown) => item as { size: number };
    sized(left).size = SIDE_SIZES[0];
    sized(created).size = parseFloat(CENTRE_STACK_SIZE);
    sized(right).size = SIDE_SIZES[1];
    try {
      layout.updateRootSize(true);
    } catch {
      /* not attached yet */
    }
  }
  return prepareCentreStack(created);
}
