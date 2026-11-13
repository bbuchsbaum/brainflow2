import { create } from 'zustand';

/**
 * Population lens view state that crosses GoldenLayout roots or is shared by
 * the centre and its dock: what the lens shows (its order, its coverage) for
 * the Subjects list and the Inspector, and the few choices more than one
 * place reads. Analytic state stays in `setStudioStore`; nothing here changes
 * a calculation.
 */
export interface PopulationCoverage {
  /** Set, feature and query identity the coverage belongs to. */
  key: string;
  /** `${setId}:${featureId}`: the set and image it describes. */
  scope: string;
  eligible: number;
  selectedRows: number;
  units: number;
  unitKind: 'participant' | 'observation';
  sources: readonly { memberId: string; sha256: string }[];
}

export type SubjectsOrder = 'montage' | 'id';
/** How the similarity map is framed: its robust core (default) or every point. */
export type SimilarityFit = 'core' | 'all';

interface PopulationViewState {
  /** The order the lens shows (Montage tiles, the movie), with its name. */
  lensOrder: { ids: readonly string[]; label: string } | null;
  /** The Subjects list follows the lens (default) or lists by ID. */
  subjectsOrder: SubjectsOrder;
  /** Width of pinned-region tiles and Summary cutouts (mm); one home: the Values tab. */
  cutoutWidthMm: number;
  /** Playback speed (subjects per second); one home: the ⋯ menu. */
  playbackSpeed: number;
  /**
   * The Values probe follows the pointer while nothing is pinned (on by
   * default; the user's choice is remembered). One home: the Values tab.
   */
  followHover: boolean;
  /** The similarity strip folded to its rail, per dataset (remembered). */
  stripCollapsed: Readonly<Record<string, boolean>>;
  coverage: PopulationCoverage | null;
  /** The similarity map's frame ("Fit core" / "Fit all"), kept for the session. */
  similarityFit: SimilarityFit;
  setSimilarityFit: (fit: SimilarityFit) => void;
  /** The statistic the Summary shows (the selection's centre needs the mean). */
  summary: string;
  /**
   * The height (px) the Values tab's body asks of the dock while it is shown:
   * one 28 px line when nothing is pinned, about 140 px when filled. Null:
   * no request (the dock keeps its remembered height). A height the user
   * dragged always wins (see `CenterWithBottomDock`).
   */
  valuesDockHeight: number | null;
  setValuesDockHeight: (height: number | null) => void;
  setSummary: (summary: string) => void;
  setLensOrder: (order: { ids: readonly string[]; label: string } | null) => void;
  setSubjectsOrder: (order: SubjectsOrder) => void;
  setCutoutWidthMm: (width: number) => void;
  setPlaybackSpeed: (speed: number) => void;
  setStripCollapsed: (dataset: string, collapsed: boolean) => void;
  setFollowHover: (follow: boolean) => void;
  setCoverage: (coverage: PopulationCoverage | null) => void;
}

export const CUTOUT_WIDTHS_MM = [16, 24, 32, 48, 64, 96] as const;
const STRIP_KEY = 'brainflow.population.similarityStrip.collapsed';
const FOLLOW_HOVER_KEY = 'brainflow.population.values.followHover';

/** Follow hover is on unless the user turned it off (remembered). */
function readFollowHover(): boolean {
  try {
    const raw = globalThis.localStorage?.getItem(FOLLOW_HOVER_KEY);
    return raw === null || raw === undefined ? true : raw !== 'false';
  } catch {
    return true;
  }
}
function writeFollowHover(value: boolean) {
  try {
    globalThis.localStorage?.setItem(FOLLOW_HOVER_KEY, String(value));
  } catch {
    // Remembering is a convenience; the toggle still works without it.
  }
}

function readCollapsed(): Record<string, boolean> {
  try {
    const raw = globalThis.localStorage?.getItem(STRIP_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
      ),
    );
  } catch {
    return {};
  }
}
function writeCollapsed(value: Record<string, boolean>) {
  try {
    globalThis.localStorage?.setItem(STRIP_KEY, JSON.stringify(value));
  } catch {
    // Remembering is a convenience; the strip still works without it.
  }
}

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

export const usePopulationViewStore = create<PopulationViewState>((set, get) => ({
  lensOrder: null,
  subjectsOrder: 'montage',
  cutoutWidthMm: 32,
  playbackSpeed: 5,
  stripCollapsed: readCollapsed(),
  followHover: readFollowHover(),
  coverage: null,
  similarityFit: 'core',
  setSimilarityFit: (fit) => {
    if (get().similarityFit !== fit) set({ similarityFit: fit });
  },
  summary: 'mean',
  valuesDockHeight: null,
  setValuesDockHeight: (height) => {
    const next = height === null || !Number.isFinite(height) ? null : Math.round(height);
    if (get().valuesDockHeight !== next) set({ valuesDockHeight: next });
  },
  setSummary: (summary) => {
    if (get().summary !== summary) set({ summary });
  },
  setLensOrder: (order) => {
    const previous = get().lensOrder;
    if (
      previous === order ||
      (previous && order && previous.label === order.label && sameIds(previous.ids, order.ids))
    )
      return;
    set({ lensOrder: order ? { ids: [...order.ids], label: order.label } : null });
  },
  setSubjectsOrder: (order) => {
    if (get().subjectsOrder !== order) set({ subjectsOrder: order });
  },
  setCutoutWidthMm: (width) => {
    if (Number.isFinite(width) && width > 0 && get().cutoutWidthMm !== width)
      set({ cutoutWidthMm: width });
  },
  setPlaybackSpeed: (speed) => {
    if (Number.isFinite(speed) && speed > 0 && get().playbackSpeed !== speed)
      set({ playbackSpeed: speed });
  },
  setStripCollapsed: (dataset, collapsed) => {
    if ((get().stripCollapsed[dataset] ?? false) === collapsed) return;
    const next = { ...get().stripCollapsed, [dataset]: collapsed };
    writeCollapsed(next);
    set({ stripCollapsed: next });
  },
  setFollowHover: (follow) => {
    if (get().followHover === follow) return;
    writeFollowHover(follow);
    set({ followHover: follow });
  },
  setCoverage: (coverage) => {
    const previous = get().coverage;
    if (
      previous === coverage ||
      (previous &&
        coverage &&
        previous.key === coverage.key &&
        previous.scope === coverage.scope &&
        previous.eligible === coverage.eligible &&
        previous.selectedRows === coverage.selectedRows &&
        previous.units === coverage.units &&
        previous.unitKind === coverage.unitKind &&
        previous.sources.length === coverage.sources.length &&
        previous.sources.every(
          (source, i) =>
            source.memberId === coverage.sources[i].memberId &&
            source.sha256 === coverage.sources[i].sha256,
        ))
    )
      return;
    set({ coverage });
  },
}));

/** Re-read remembered strip state (tests). */
export function reloadPopulationViewMemory() {
  usePopulationViewStore.setState({
    stripCollapsed: readCollapsed(),
    followHover: readFollowHover(),
  });
}
