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
 * - the centre stack has no stack-level ×; tabs close one at a time with
 *   their own × (the last one brings back a default view);
 * - when GoldenLayout drops the stack anyway (the last tab closed or dragged
 *   out), `ensureCentreStack` puts an empty one back in its place.
 */

import type { GoldenLayout, LayoutManager, Stack, StackItemConfig } from 'golden-layout';

/** Share of the root row the centre takes in the default shell (see layoutService). */
export const CENTRE_STACK_SIZE = '59.75%';

const CENTRE_MARK = 'bfCentreStack';

/**
 * `LayoutManager.LocationSelector.TypeId.Root`: a child of the root item at
 * `index`. Spelled out because the enum is a `const enum`, which the bundler
 * cannot inline.
 */
const ROOT_LOCATION = 7 as LayoutManager.LocationSelector.TypeId.Root;

/** The centre stack, or null when the root row has none in the middle. */
export function getCentreStack(layout: GoldenLayout | null | undefined): Stack | null {
  const root = layout?.rootItem;
  if (!root || root.type !== 'row') return null;
  const centre = root.contentItems[1];
  return centre?.type === 'stack' ? (centre as Stack) : null;
}

/**
 * Drop the stack header's ×. GoldenLayout keeps toggling the button's
 * visibility through its own reference, so it is detached rather than hidden.
 */
function prepareCentreStack(stack: Stack): Stack {
  const element = stack.element as HTMLElement | undefined;
  if (element?.dataset[CENTRE_MARK] === 'true') return stack;
  const controls = stack.header?.controlsContainerElement as HTMLElement | undefined;
  controls?.querySelectorAll('.lm_close').forEach((button) => button.remove());
  if (element) element.dataset[CENTRE_MARK] = 'true';
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

  const config: StackItemConfig = { type: 'stack', size: CENTRE_STACK_SIZE, content: [] };
  try {
    const index = Math.min(1, root.contentItems.length);
    layout.addItemAtLocation(config, [{ typeId: ROOT_LOCATION, index }]);
  } catch (error) {
    console.error('[centreStack] Failed to restore the centre stack:', error);
    return null;
  }
  const created = getCentreStack(layout);
  return created ? prepareCentreStack(created) : null;
}
