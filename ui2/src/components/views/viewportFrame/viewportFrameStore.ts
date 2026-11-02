import { createContext, useContext } from 'react';
import { create } from 'zustand';
import type { FramePlane } from './frameFormat';
import { ColorbarFit } from './colorbarPlacement';

/** Per-view layout facts the colorbar host choice needs (CSS px). */
export interface FrameSlot {
  /** Canvas-area size. */
  area: number;
  /** How well the view holds the colorbar (colorbarPlacement.ts `placeColorbarBlock`). */
  fit: ColorbarFit;
  /** Area of the free margin the colorbar would take (0 for a corner). */
  room: number;
}

export interface ColorbarHost {
  plane: FramePlane;
  /** Since when (ms) the host has held a full margin; null while it does not. */
  fullSince: number | null;
  /**
   * The host held a full margin for HOST_SETTLE_MS or more: it then keeps the
   * colorbar when it narrows to a compact margin. A full margin seen only
   * briefly (start-up, a layout pass) never makes it sticky.
   */
  settledFull: boolean;
}

type GroupSlots = Partial<Record<FramePlane, FrameSlot>>;

interface ViewportFrameState {
  slots: Record<string, GroupSlots>;
  hosts: Record<string, ColorbarHost>;
  setSlot: (group: string, plane: FramePlane, slot: FrameSlot | null) => void;
}

export interface ColorbarGroup {
  /** The set of slice views sharing one colorbar. */
  group: string;
  /**
   * The layer the colorbar describes, whatever is selected or stacked (a
   * Studio viewer: its member, even as the base layer). Null: the usual rule.
   */
  describeLayerId: string | null;
}

/**
 * A set of slice views that shares one colorbar: the main Orthogonal and
 * Integrated views (default), or a Studio viewer. Views of different groups
 * with the same plane do not overwrite each other's slot.
 */
export const ColorbarGroupContext = createContext<ColorbarGroup>({
  group: 'main',
  describeLayerId: null,
});

export const useColorbarGroup = () => useContext(ColorbarGroupContext);

/** Another view must have this much more margin to take the colorbar at the same fit. */
export const HOST_HYSTERESIS = 1.25;
/** How long a host must hold a full margin before narrowing keeps the bar in place. */
export const HOST_SETTLE_MS = 500;

const ORDER: FramePlane[] = ['axial', 'coronal', 'sagittal'];

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * The view that hosts a group's single colorbar.
 *
 * Best: the highest fit (full block in a margin, compact block in a margin,
 * a corner over the image), then the largest margin, then the largest view;
 * axial, coronal, sagittal on ties.
 *
 * Stable (QA 2026-10-31 N16): the current host keeps the colorbar unless
 * another view is clearly better: a higher fit, or the same fit with
 * HOST_HYSTERESIS times its margin (its area, for corners). A host that held
 * a full margin (settled, HOST_SETTLE_MS) keeps the colorbar when it narrows
 * to a compact one, rather than the bar jumping to another view.
 */
export function chooseColorbarHost(
  slots: GroupSlots,
  current: ColorbarHost | null = null,
  at: number = now(),
): ColorbarHost | null {
  let best: FramePlane | null = null;
  for (const plane of ORDER) {
    const s = slots[plane];
    if (!s || s.fit === ColorbarFit.None) continue;
    const b = best ? slots[best]! : null;
    if (
      !b ||
      s.fit > b.fit ||
      (s.fit === b.fit && (s.room > b.room || (s.room === b.room && s.area > b.area)))
    ) {
      best = plane;
    }
  }
  if (!best) return null;
  const fresh = (plane: FramePlane): ColorbarHost => {
    const full = slots[plane]!.fit === ColorbarFit.FullMargin;
    return { plane, fullSince: full ? at : null, settledFull: false };
  };
  const cur = current ? slots[current.plane] : undefined;
  if (!current || !cur || cur.fit === ColorbarFit.None) return fresh(best);

  // The current host's full-margin history.
  const heldFull = current.fullSince !== null && at - current.fullSince >= HOST_SETTLE_MS;
  let next: ColorbarHost;
  if (cur.fit === ColorbarFit.FullMargin) {
    const fullSince = current.fullSince ?? at;
    next = {
      plane: current.plane,
      fullSince,
      settledFull: current.settledFull || at - fullSince >= HOST_SETTLE_MS,
    };
  } else if (cur.fit === ColorbarFit.CompactMargin) {
    next = { plane: current.plane, fullSince: null, settledFull: current.settledFull || heldFull };
  } else {
    next = { plane: current.plane, fullSince: null, settledFull: false };
  }

  const top = slots[best]!;
  const measure = (s: FrameSlot) => (s.fit === ColorbarFit.Corner ? s.area : s.room);
  const keep =
    best === current.plane ||
    cur.fit > top.fit ||
    (cur.fit === top.fit && measure(top) <= measure(cur) * HOST_HYSTERESIS) ||
    // Narrowed from a settled full margin to a compact one: stays, compact.
    (cur.fit === ColorbarFit.CompactMargin &&
      next.settledFull &&
      top.fit === ColorbarFit.FullMargin);
  if (!keep) return fresh(best);
  const same = next.fullSince === current.fullSince && next.settledFull === current.settledFull;
  return same ? current : next;
}

/**
 * Slice views publish their area and colorbar fit here so a single view per
 * group hosts the colorbar (GoldenLayout panels have separate React roots, so
 * this cannot be context alone).
 */
export const useViewportFrameStore = create<ViewportFrameState>((set, get) => ({
  slots: {},
  hosts: {},
  setSlot: (group, plane, slot) => {
    const groupSlots = get().slots[group] ?? {};
    const prev = groupSlots[plane];
    if (!slot && !prev) return;
    if (slot && prev && prev.area === slot.area && prev.fit === slot.fit && prev.room === slot.room)
      return;
    const nextGroup = { ...groupSlots };
    if (slot) nextGroup[plane] = slot;
    else delete nextGroup[plane];
    const currentHost = get().hosts[group] ?? null;
    const host = chooseColorbarHost(nextGroup, currentHost);
    const slots = { ...get().slots };
    const hosts = { ...get().hosts };
    // Empty groups (a Studio viewer closed) leave no entries behind.
    if (Object.keys(nextGroup).length > 0) slots[group] = nextGroup;
    else delete slots[group];
    if (host) hosts[group] = host;
    else delete hosts[group];
    set({ slots, hosts: host === currentHost ? get().hosts : hosts });
  },
}));
