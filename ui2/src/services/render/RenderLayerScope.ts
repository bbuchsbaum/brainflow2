/**
 * RenderLayerScope - an explicit layer list for the shared orthogonal views.
 *
 * The orthogonal slice views render the workspace ViewState. A view that
 * borrows them to show something else (the Set studio Deck shows one member)
 * sets a scope here: while it is set, only the listed layers are drawn, and
 * the workspace layers stay out of the render request (QA rerun §2). The
 * scope lists its layers bottom first and they are drawn in that order,
 * whatever order the workspace stacks them in (a Studio background template
 * stays beneath its member). The layer store and the workspace scene are not
 * touched.
 */

import type { ViewState } from '@/types/viewState';

interface Scope {
  owner: string;
  /** Bottom first, each id once. */
  layerIds: readonly string[];
}

let scope: Scope | null = null;
let revision = 0;
const listeners = new Set<() => void>();

function notify(): void {
  revision += 1;
  listeners.forEach((listener) => listener());
}

/**
 * Draw only `layerIds`, bottom first, in the orthogonal views until `owner`
 * clears it.
 */
export function setRenderLayerScope(owner: string, layerIds: readonly string[]): void {
  const next = [...new Set(layerIds)];
  if (
    scope &&
    scope.owner === owner &&
    scope.layerIds.length === next.length &&
    next.every((id, index) => scope!.layerIds[index] === id)
  ) {
    return;
  }
  scope = { owner, layerIds: next };
  notify();
}

/** Remove `owner`'s scope; a scope set since by another owner stays. */
export function clearRenderLayerScope(owner: string): void {
  if (!scope || scope.owner !== owner) return;
  scope = null;
  notify();
}

export function hasRenderLayerScope(): boolean {
  return scope !== null;
}

/** Changes whenever the scope is set or cleared. */
export function getRenderLayerScopeRevision(): number {
  return revision;
}

export function subscribeRenderLayerScope(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The ViewState the views should draw: the workspace one, or its scoped subset. */
export function applyRenderLayerScope(viewState: ViewState): ViewState {
  if (!scope) return viewState;
  const byId = new Map(viewState.layers.map((layer) => [layer.id, layer]));
  return { ...viewState, layers: scope.layerIds.flatMap((id) => byId.get(id) ?? []) };
}

/** Test hook. */
export function resetRenderLayerScope(): void {
  scope = null;
  revision = 0;
  listeners.clear();
}
