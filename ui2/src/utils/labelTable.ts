/**
 * Label tables for user-loaded parcellations (UI redesign phase 3, item 4).
 *
 * Two sidecar formats are read:
 * - BIDS `dseg.tsv` (same stem as the image, `.tsv`): a header row with an
 *   `index` column, a `name` column and optionally `color` (`#rrggbb`).
 *   Other columns (abbreviation, hemisphere, mapping) are ignored.
 * - FreeSurfer colour LUT (`FreeSurferColorLUT.txt` layout): headerless
 *   whitespace-separated rows `id name R G B [A]`, `#` comments.
 *
 * The parsed rows become the layer's `atlasPaletteLegend` (region at the
 * crosshair) and a categorical LUT for `register_categorical_colormap`
 * (texel k = colour of label k, label 0 transparent).
 */
import type { AtlasPaletteLegendEntry } from '@/types/atlasPalette';

export interface LabelTableEntry {
  id: number;
  name: string;
  color: [number, number, number] | null;
}

/** Highest label id the GPU categorical LUT holds (COLORMAP_LUT_WIDTH - 1). */
export const MAX_CATEGORICAL_LABEL = 2047;

/** Sidecar paths to try for an image path, most specific first. */
export function labelSidecarCandidates(imagePath: string): string[] {
  const match = /^(.*?)(\.nii\.gz|\.nii|\.mgz|\.mgh)$/i.exec(imagePath);
  if (!match) return [];
  const stem = match[1];
  return [`${stem}.tsv`, `${stem}.lut`, `${stem}.txt`];
}

function parseHexColor(text: string | undefined): [number, number, number] | null {
  if (!text) return null;
  const m = /^#?([0-9a-f]{6})$/i.exec(text.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function parseId(text: string | undefined): number | null {
  if (text === undefined || !/^\s*\d+\s*$/.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) ? id : null;
}

const INDEX_COLUMNS = ['index', 'label', 'id', 'label_id', 'value'];
const NAME_COLUMNS = ['name', 'label_name', 'region', 'roi', 'structure'];
const COLOR_COLUMNS = ['color', 'colour'];

function parseTsv(lines: string[]): LabelTableEntry[] {
  const header = lines[0].split('\t').map((h) => h.trim().toLowerCase());
  const find = (names: string[]) => header.findIndex((h) => names.includes(h));
  const idCol = find(INDEX_COLUMNS);
  // A header that names its label column `label` alongside an `index` uses
  // `label` as the name; prefer real name columns first.
  let nameCol = find(NAME_COLUMNS);
  if (nameCol === idCol) nameCol = -1;
  const colorCol = find(COLOR_COLUMNS);
  if (idCol < 0 || nameCol < 0) return [];
  const out: LabelTableEntry[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split('\t');
    const id = parseId(cells[idCol]);
    const name = cells[nameCol]?.trim();
    if (id === null || !name) continue;
    out.push({ id, name, color: colorCol >= 0 ? parseHexColor(cells[colorCol]) : null });
  }
  return out;
}

/**
 * A headerless LUT row: `id name R G B [A]`, at least five columns, a
 * non-numeric name and RGB in 0..255. A table is accepted only when most
 * rows are such rows, so notes or a column of numbers in a same-stem `.txt`
 * ("12 34 56 ...") never turn an image into a label map (review D3).
 */
function parseFreeSurferLut(lines: string[]): LabelTableEntry[] {
  const out: LabelTableEntry[] = [];
  for (const line of lines) {
    const cells = line.trim().split(/\s+/);
    const id = parseId(cells[0]);
    if (id === null || cells.length < 5) continue;
    if (/^[-+]?\d*\.?\d+$/.test(cells[1])) continue;
    const rgb = cells.slice(2, 5).map(Number);
    if (!rgb.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)) continue;
    out.push({ id, name: cells[1], color: rgb as [number, number, number] });
  }
  return out.length >= Math.max(1, Math.ceil(lines.length * 0.8)) ? out : [];
}

/**
 * Parse a BIDS dseg TSV or a FreeSurfer LUT. Returns [] when the text is
 * neither (so an unrelated `.txt` next to an image is ignored). Duplicate ids
 * keep the first row.
 */
export function parseLabelTable(text: string): LabelTableEntry[] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '' && !l.trimStart().startsWith('#'));
  if (lines.length === 0) return [];
  const header = lines[0]
    .toLowerCase()
    .split('\t')
    .map((h) => h.trim());
  const rows = header.some((h) => INDEX_COLUMNS.includes(h))
    ? parseTsv(lines)
    : parseFreeSurferLut(lines);
  const seen = new Set<number>();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

/**
 * Deterministic categorical colour for labels a table leaves uncoloured:
 * golden-angle hues at fixed saturation/lightness (data colour, not chrome).
 */
export function fallbackLabelColor(id: number): [number, number, number] {
  const h = ((id * 137.508) % 360) / 360;
  const s = 0.62;
  const l = 0.56;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)].map((v) => Math.round(v * 255)) as [
    number,
    number,
    number,
  ];
}

export interface LabelTablePalette {
  /** Highest label id in the LUT. */
  maxLabel: number;
  /** `(maxLabel + 1) * 3` bytes, texel k = label k; label 0 black (transparent on the GPU). */
  lutRgb: number[];
  legend: AtlasPaletteLegendEntry[];
  /** Ids beyond `MAX_CATEGORICAL_LABEL` (named in the legend but not coloured). */
  uncoloured: number[];
}

/** Legend + categorical LUT for a parsed table (label 0 is background). */
export function buildLabelPalette(entries: LabelTableEntry[]): LabelTablePalette {
  const labels = entries.filter((e) => e.id > 0);
  const legend: AtlasPaletteLegendEntry[] = labels.map((e) => ({
    label_id: e.id,
    roi: e.name,
    // Shown verbatim: these are the user's own region names.
    displayName: e.name,
    color: e.color ?? fallbackLabelColor(e.id),
    network: null,
    hemisphere: null,
  }));
  const inLut = legend.filter((e) => e.label_id <= MAX_CATEGORICAL_LABEL);
  const maxLabel = inLut.reduce((m, e) => Math.max(m, e.label_id), 0);
  const lutRgb = new Array<number>((maxLabel + 1) * 3).fill(0);
  for (const e of inLut) lutRgb.splice(e.label_id * 3, 3, ...e.color);
  return {
    maxLabel,
    lutRgb,
    legend,
    uncoloured: legend.filter((e) => e.label_id > MAX_CATEGORICAL_LABEL).map((e) => e.label_id),
  };
}

// Filename tokens that indicate a discrete parcellation / segmentation / atlas
// volume (integer region IDs). Such volumes MUST render with nearest-neighbour
// sampling (label mode); trilinear interpolation averages adjacent region IDs
// into meaningless intermediate values (e.g. labels 17 and 1024 -> ~520). The
// list is intentionally name-driven and conservative so continuous int16
// anatomicals are not misclassified. (Follow-up: a data-driven heuristic —
// integer dtype + small distinct-value count — would also catch unnamed atlases
// but needs a backend distinct-value count; see audit-backlog.)
//
// Matched on whole name TOKENS (split at _ - . + and spaces; BIDS entities
// and suffixes), never substrings: "yeo" must not match `task-eyeopen`, nor
// "roi" `steroid` (review D3 / R12).
const SEGMENTATION_WORDS = new Set([
  'seg',
  'dseg',
  'aseg',
  'segmentation',
  'parc',
  'aparc',
  'wmparc',
  'parcellation',
  'atlas',
  'label',
  'labels',
  'roi',
  'rois',
]);
/** Atlas families, alone or with a version / resolution ("yeo2011", "aal3v1"). */
const ATLAS_FAMILY =
  /^(schaefer|yeo|aal|desikan|destrieux|harvardoxford|glasser|brodmann|juelich|talairach)(\d.*)?$/;
/** Continuous maps whose names carry label words (BIDS `label-GM_probseg`). */
const CONTINUOUS_WORDS = new Set(['probseg', 'probmap', 'prob', 'pve']);

/** Name tokens of a file name (extension dropped, lower case). */
export function nameTokens(name: string): string[] {
  const base = name.toLowerCase().replace(/^.*[\\/]/, '').replace(/(\.nii\.gz|\.nii|\.mgz|\.mgh|\.gii)$/, '');
  return base.split(/[_\-.+\s]+/).filter(Boolean);
}

export function looksLikeSegmentation(lowerName: string): boolean {
  const tokens = nameTokens(lowerName);
  if (tokens.some((t) => CONTINUOUS_WORDS.has(t))) return false;
  return tokens.some(
    (t) => SEGMENTATION_WORDS.has(t) || ATLAS_FAMILY.test(t) || (t.endsWith('seg') && t.length > 3),
  );
}
