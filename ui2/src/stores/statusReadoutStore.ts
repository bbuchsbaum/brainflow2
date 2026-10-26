import { create } from 'zustand';

/**
 * Which layer the status bar's Layer / Value slots read when a workspace
 * shows several layers side by side (Compare). A Compare panel claims the
 * readout while the pointer is over it or after it takes focus, and releases
 * it when the Compare workspace unmounts. Null = the global active-layer rule.
 */
export interface StatusReadoutOverride {
  /** Claiming source (e.g. a Compare panel id); used for scoped release. */
  source: string;
  layerId: string;
  name: string;
}

interface StatusReadoutState {
  override: StatusReadoutOverride | null;
  claim: (next: StatusReadoutOverride) => void;
  /** Release only if `source` still holds the readout (null = any source). */
  release: (source: string | null) => void;
}

export const useStatusReadoutStore = create<StatusReadoutState>((set, get) => ({
  override: null,
  claim: (next) => {
    const cur = get().override;
    if (
      cur &&
      cur.source === next.source &&
      cur.layerId === next.layerId &&
      cur.name === next.name
    ) {
      return;
    }
    set({ override: next });
  },
  release: (source) => {
    const cur = get().override;
    if (!cur) return;
    if (source !== null && cur.source !== source) return;
    set({ override: null });
  },
}));
