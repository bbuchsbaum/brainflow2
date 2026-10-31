import type {
  PopulationOrientation,
  PopulationSummary,
} from '@/services/studio/PopulationSliceService';

interface LensView {
  session: number;
  restored: unknown;
  orientation: PopulationOrientation;
  summary: PopulationSummary;
  zoom: number;
}

let last: LensView | null = null;

/**
 * The Population lens's last view (plane, summary, zoom) per Studio session.
 * The lens is a singleton; reopening it in the same session and restore
 * keeps its view (QA F44: the Summary fell back from Median to Mean).
 */
export const populationLensMemory = {
  recall(session: number, restored: unknown): LensView | null {
    return last && last.session === session && last.restored === restored ? last : null;
  },
  remember(view: LensView): void {
    last = view;
  },
  /** Test hook. */
  reset(): void {
    last = null;
  },
};
