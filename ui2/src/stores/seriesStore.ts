/**
 * Series plot settings (phase 4 E5): which source the Series mode shows and
 * how the population stage reduces it. Shared by every Plot dock root
 * (GoldenLayout panels have separate React roots); not persisted.
 */
import { create } from 'zustand';
import type { PopulationPlotRecipe, PopulationTransform } from '@/services/studio/populationPlot';
import type { SegmentLayout } from '@/services/series/seriesSegments';

export type SeriesSourceChoice = 'auto' | 'layer' | 'set';
export type SeriesLocusKind = 'point' | 'sphere' | 'region' | 'cluster';

export interface SeriesSettings {
  source: SeriesSourceChoice;
  /**
   * Locus: the voxel nearest the crosshair, a sphere around it, the atlas /
   * label region at the crosshair (E2), or the cluster row selected in the
   * Clusters tab (E3).
   */
  locus: SeriesLocusKind;
  /** Sphere radius (mm) when `locus` is a sphere. */
  radiusMm: number;
  /**
   * The region locus: a parcel picked from the atlas / label legend, or null
   * for the region at the crosshair.
   */
  regionPick: { layerId: string; labelId: number } | null;
  summary: 'mean' | 'median';
  band: PopulationPlotRecipe['band'];
  /** Population summary lines, or one line per participant (click focuses). */
  display: 'summary' | 'participants';
  transforms: PopulationTransform[];
  /**
   * Segments of a raw 4D series (E5b): 'auto' groups the layer with its runs
   * (BIDS names that differ only in run / ses) or splits it by a runs
   * sidecar; 'off' plots the layer alone; 'manual' uses `manualSegmentLayerIds`.
   */
  segments: 'auto' | 'off' | 'manual';
  manualSegmentLayerIds: string[];
  /** The 4D-layer series' run layout; null: concatenated. */
  segmentLayout: SegmentLayout | null;
  /** The dataset series' runs: one panel per run (true) or pooled within participant (REVIEW n4: not shared with the 4D layout). */
  datasetRunsFaceted: boolean;
}

interface SeriesStore extends SeriesSettings {
  update: (patch: Partial<SeriesSettings>) => void;
  reset: () => void;
}

export const DEFAULT_SERIES_SETTINGS: SeriesSettings = {
  source: 'auto',
  locus: 'sphere',
  radiusMm: 6,
  regionPick: null,
  summary: 'mean',
  band: 'ci95',
  display: 'summary',
  transforms: [],
  segments: 'auto',
  manualSegmentLayerIds: [],
  segmentLayout: null,
  datasetRunsFaceted: false,
};

export const useSeriesStore = create<SeriesStore>((set) => ({
  ...DEFAULT_SERIES_SETTINGS,
  update: (patch) => set(patch),
  reset: () => set({ ...DEFAULT_SERIES_SETTINGS }),
}));

/** The sampling radius the settings ask for (0 for a point; regions ignore it). */
export const seriesRadiusMm = (s: Pick<SeriesSettings, 'locus' | 'radiusMm'>) =>
  s.locus === 'sphere' ? s.radiusMm : 0;
