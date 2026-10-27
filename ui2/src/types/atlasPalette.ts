export type AtlasPaletteKind =
  | 'maximin_view'
  | 'network_harmony'
  | 'rule_hcl'
  | 'embedding';

export const ATLAS_PALETTE_OPTIONS: Array<{ value: AtlasPaletteKind; label: string }> = [
  { value: 'network_harmony', label: 'Network harmony' },
  { value: 'maximin_view', label: 'Maximin view' },
  { value: 'rule_hcl', label: 'Rule HCL' },
  { value: 'embedding', label: 'Embedding' },
];

export interface AtlasPaletteLut {
  max_label: number;
  lut_rgb: number[];
  background: [number, number, number];
  kind: AtlasPaletteKind;
  seed: number;
}

export interface AtlasPaletteLegendEntry {
  label_id: number;
  roi: string;
  color: [number, number, number];
  network?: string | null;
  hemisphere?: string | null;
  /**
   * Region text shown verbatim (status Region slot, hover). Set for label
   * tables the user supplied (BIDS dseg TSV / FreeSurfer LUT sidecars), whose
   * names must not be reformatted; catalogue atlases leave it unset.
   */
  displayName?: string;
}

export interface AtlasPaletteResponse {
  lut: AtlasPaletteLut;
  legend: AtlasPaletteLegendEntry[];
}
