/**
 * Surface tabs across a relaunch (qa-features-2026-10-31 §9): describe the
 * live surface tabs for `surfaceTabRestoreStore`, and turn a saved one into a
 * placeholder tab. Nothing here loads anything: a placeholder reloads its
 * surfaces only when the user presses Reload.
 */

import type { ComponentItemConfig, ContentItem } from 'golden-layout';

import type { SavedSurfaceTab, SurfaceTabSource } from '@/stores/surfaceTabRestoreStore';
import { surfaceGroupKey } from '@/utils/surfaceIdentity';

/** GoldenLayout component type of a placeholder surface tab. */
export const SURFACE_PLACEHOLDER_COMPONENT = 'surfacePlaceholder';

interface SurfaceLike {
  handle: string;
  metadata: { path: string };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Where a surface came from, by its path: a TemplateFlow template or a file. */
export function surfaceSourceFromPath(path: string | null | undefined): SurfaceTabSource | null {
  if (!path) return null;
  // `templateflow://<space>_<geometry>_<hemisphere>` (SurfaceLoadingService).
  const template = path.match(/^templateflow:\/\/(.+)_([^_]+)_([^_]+)$/i);
  if (template) {
    return {
      kind: 'template',
      path,
      space: template[1],
      geometryType: template[2],
      hemisphere: template[3],
    };
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return null; // some other scheme
  return { kind: 'file', path };
}

function componentItems(root: ContentItem | null | undefined): ContentItem[] {
  const found: ContentItem[] = [];
  const visit = (item: ContentItem | null | undefined) => {
    if (!item) return;
    if (item.type === 'component') found.push(item);
    else item.contentItems?.forEach(visit);
  };
  visit(root);
  return found;
}

function itemState(item: ContentItem): Record<string, unknown> {
  const state = (item as { container?: { initialState?: unknown } }).container?.initialState;
  return isRecord(state) ? state : {};
}

/**
 * The surface tabs in `root` (live ones and placeholders not reloaded yet), in
 * layout order. A live tab lists every surface of its scene: the one it was
 * opened for, plus surfaces sharing its group key (Left and Right).
 */
export function describeSurfaceTabs(
  root: ContentItem | null | undefined,
  surfaces: Iterable<SurfaceLike>,
): SavedSurfaceTab[] {
  const loaded = [...surfaces];
  const tabs: SavedSurfaceTab[] = [];
  for (const item of componentItems(root)) {
    const type = (item as { componentType?: unknown }).componentType;
    const state = itemState(item);
    const title = (item as { title?: string }).title ?? '';
    if (type === SURFACE_PLACEHOLDER_COMPONENT) {
      const saved = state.saved;
      if (isRecord(saved) && Array.isArray(saved.sources))
        tabs.push(saved as unknown as SavedSurfaceTab);
      continue;
    }
    if (type !== 'surfaceView') continue;
    const groupKey =
      typeof state.groupKey === 'string'
        ? state.groupKey
        : typeof state.path === 'string'
          ? surfaceGroupKey(state.path)
          : null;
    const members = loaded.filter(
      (surface) =>
        surface.handle === state.surfaceHandle ||
        (groupKey !== null && surfaceGroupKey(surface.metadata.path) === groupKey),
    );
    const paths = members.map((surface) => surface.metadata.path);
    if (paths.length === 0 && typeof state.path === 'string') paths.push(state.path);
    const sources: SurfaceTabSource[] = [];
    for (const path of paths) {
      const source = surfaceSourceFromPath(path);
      if (source && !sources.some((s) => s.path === source.path)) sources.push(source);
    }
    if (sources.length === 0) continue;
    tabs.push({
      surfaceViewId: typeof state.surfaceViewId === 'string' ? state.surfaceViewId : title,
      title,
      sources,
    });
  }
  return tabs;
}

/** The GoldenLayout item for a saved surface tab's placeholder. */
export function placeholderItemConfig(saved: SavedSurfaceTab): ComponentItemConfig {
  return {
    type: 'component',
    componentType: SURFACE_PLACEHOLDER_COMPONENT,
    title: saved.title,
    componentState: { saved } as unknown as ComponentItemConfig['componentState'],
  };
}

/** The key of a centre tab in the saved strip order, or null for other tabs. */
export function centreTabKey(item: ContentItem): string | null {
  const type = (item as { componentType?: unknown }).componentType;
  const state = itemState(item);
  if (type === 'Workspace' && typeof state.workspaceId === 'string') return `ws:${state.workspaceId}`;
  if (type === 'surfaceView' && typeof state.surfaceViewId === 'string') {
    return `sv:${state.surfaceViewId}`;
  }
  if (type === SURFACE_PLACEHOLDER_COMPONENT && isRecord(state.saved)) {
    const id = state.saved.surfaceViewId;
    return typeof id === 'string' ? `sv:${id}` : null;
  }
  return null;
}

/** The centre strip's order, for the next launch. */
export function centreTabOrder(stack: { contentItems: ContentItem[] } | null): string[] {
  return (stack?.contentItems ?? []).flatMap((item) => {
    const key = centreTabKey(item);
    return key ? [key] : [];
  });
}

type OrderableStack = {
  contentItems: ContentItem[];
  removeChild(item: ContentItem, keepChild: boolean): void;
  addChild(item: ContentItem, index?: number, focus?: boolean): number;
};

/**
 * Put the strip back in its saved order (QA 2026-10-31: relaunch put the
 * surface placeholders first). Tabs the saved order does not know keep their
 * relative order after the known ones. Moves only; nothing is destroyed.
 */
export function applyCentreTabOrder(stack: OrderableStack, order: readonly string[]): void {
  const rank = new Map(order.map((key, index) => [key, index]));
  const items = [...stack.contentItems];
  const wanted = items
    .map((item, index) => ({ item, index, rank: rank.get(centreTabKey(item) ?? '') }))
    .sort(
      (a, b) =>
        (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) || a.index - b.index,
    )
    .map((entry) => entry.item);
  wanted.forEach((item, target) => {
    const at = stack.contentItems.indexOf(item);
    if (at === target) return;
    stack.removeChild(item, true);
    stack.addChild(item, target);
  });
}

/**
 * The saved strip order while relaunch is still putting tabs back. It ends
 * when the restored tabs are all in (`finish`), and in any case after
 * `windowMs`: a restored tab that failed to add must not stop the order
 * from being saved for the rest of the session (review L5).
 */
export class PendingTabOrder {
  private readonly order: readonly string[];
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly startedAt: number;
  private finished = false;

  constructor(order: readonly string[], windowMs = 5000, now: () => number = () => Date.now()) {
    this.order = order;
    this.windowMs = windowMs;
    this.now = now;
    this.startedAt = now();
  }

  /** The order to apply, or null once restore is over. */
  current(): readonly string[] | null {
    if (this.finished || this.now() - this.startedAt > this.windowMs) return null;
    return this.order;
  }

  finish(): void {
    this.finished = true;
  }
}
