/**
 * The subject under the pointer, shared across the Studio's React roots (the
 * montage, the similarity map, the Inspector's lists and the Values dock are
 * separate GoldenLayout roots). Presentation state only: it never changes
 * focus, selection or summaries. `source` says which view published it, so a
 * view does not echo its own hover back.
 */
export type MemberHoverSource = 'map' | 'inspector' | 'montage' | 'values';
export interface MemberHover {
  memberId: string | null;
  source: MemberHoverSource | null;
}

const idle: MemberHover = { memberId: null, source: null };
let current: MemberHover = idle;
const listeners = new Set<() => void>();

export const populationMemberHover = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot(): MemberHover {
    return current;
  },
  /** Publish (or, with null, withdraw) the hovered subject. A no-op update notifies no one. */
  set(memberId: string | null, source: MemberHoverSource) {
    // Withdrawing only clears what this source published.
    if (memberId === null && current.source !== source) return;
    const next = memberId === null ? idle : { memberId, source };
    if (next.memberId === current.memberId && next.source === current.source) return;
    current = next;
    for (const listener of listeners) listener();
  },
  /** Test and teardown helper. */
  reset() {
    if (current === idle) return;
    current = idle;
    for (const listener of listeners) listener();
  },
};
