/**
 * Pure geometry of the Coverage matrix: where rows and columns sit, and the
 * marks of a set of rows as one path per style. Thousands of cells become a
 * handful of DOM nodes, so 400 participants by 40 columns stays cheap.
 */
import { FD_SPARK_MAX_MM, type BidsCell, type BidsColumn, type BidsMatrixRow, type BidsModel, type BidsSessionFd } from '@/stores/bidsModel';

/** Above this many participants rows compress to `COMPRESSED_ROW_PX`. */
export const COMPRESS_ABOVE = 120;
export const ROW_PX = 16;
export const COMPRESSED_ROW_PX = 3;
/** Focus band heights by distance from the selection, then the row height. */
export const FOCUS_BAND: ReadonlyArray<{ upTo: number; height: number }> = [
  { upTo: 0, height: 16 },
  { upTo: 3, height: 10 },
  { upTo: 6, height: 5 },
];
const FOCUS_REACH = 6;
const SPARK_MIN_ROW_PX = 10;
const FD_TICKS = [0, 0.25, 0.5, 0.75];
const FD_SCALE_MIN = 0.8;

export interface CoverageLayout {
  compressed: boolean;
  rowPx: number;
  colW: number;
  gap: number;
  /** Left edge of the first column. */
  matrixX: number;
  colX: number[];
  matrixEnd: number;
  derivX: number;
  derivW: number;
  fdX: number;
  fdW: number;
  fdGap: number;
  fdMax: number;
  fdTicks: number[];
  width: number;
  /** Top of each row in the base layer. */
  rowY: number[];
  groupY: Array<{ y: number; label: string; count: number }>;
  /** Height of the matrix including unread rows. */
  height: number;
  /** Most the focus band adds to `height`. */
  bandExtra: number;
  pendingY: number | null;
}

export function fdX(layout: CoverageLayout, sessionIndex: number, mm: number): number {
  const v = Math.min(mm, layout.fdMax);
  return layout.fdX + sessionIndex * (layout.fdW + layout.fdGap) + (v / layout.fdMax) * layout.fdW;
}

/** Sparklines take spare width up to this, so a large window shows more of each trace. */
const MAX_COL_PX = 72;

export function buildCoverageLayout(model: BidsModel, availablePx = 0): CoverageLayout {
  const compressed = model.rows.length + model.pendingRows > COMPRESS_ABOVE;
  const rowPx = compressed ? COMPRESSED_ROW_PX : ROW_PX;
  const gap = compressed ? 10 : 12;
  const matrixX = 112;
  const minColW = compressed ? 15 : 30;
  // Width of everything but the columns, at the minimum column width.
  const sessionGaps = new Set(model.columns.map((column) => column.session)).size - 1;
  const margins = 340 + model.derivativeColumns.length * 20 + (model.summary.hasFd ? model.sessions.length * 82 : 0);
  const spare = availablePx - matrixX - margins - Math.max(0, sessionGaps) * gap;
  const colW =
    compressed || model.columns.length === 0
      ? minColW
      : Math.max(minColW, Math.min(MAX_COL_PX, Math.floor(spare / model.columns.length)));

  const colX: number[] = [];
  let x = matrixX;
  let previous: BidsColumn | null = null;
  for (const column of model.columns) {
    if (previous && previous.session !== column.session) x += gap;
    colX.push(x);
    x += colW;
    previous = column;
  }
  const matrixEnd = x;

  const derivX = matrixEnd + gap + 10;
  const derivW = 20;
  const derivCount = model.derivativeColumns.length;
  const fdStart = derivX + (derivCount ? derivCount * derivW + 14 : 0);
  const fdW = 64;
  const fdGap = 18;
  const sessionCount = model.summary.hasFd ? model.sessions.length : 0;
  // One session's strip is narrower than the captions above it.
  const fdCaptionPx = sessionCount > 0 ? 170 : 0;
  const width = fdStart + Math.max(sessionCount * (fdW + fdGap) + 30, fdCaptionPx);

  const rowY: number[] = [];
  const groupY: CoverageLayout['groupY'] = [];
  let y = 0;
  let group = 0;
  for (const row of model.rows) {
    if (model.groups[group]?.firstRow === row.index) {
      groupY.push({ y, label: model.groups[group].label, count: model.groups[group].count });
      y += ROW_PX;
      group += 1;
    }
    rowY.push(y);
    y += rowPx;
  }
  const pendingY = model.pendingRows > 0 ? y : null;
  y += model.pendingRows * rowPx;

  const bandExtra = compressed
    ? FOCUS_BAND.reduce((sum, band, i) => {
        const lower = i === 0 ? 0 : FOCUS_BAND[i - 1].upTo + 1;
        const rows = lower === 0 ? 1 : (band.upTo - lower + 1) * 2;
        return sum + rows * band.height;
      }, 0)
    : 0;

  return {
    compressed,
    rowPx,
    colW,
    gap,
    matrixX,
    colX,
    matrixEnd,
    derivX,
    derivW,
    fdX: fdStart,
    fdW,
    fdGap,
    fdMax: Math.max(FD_SCALE_MIN, model.fdThreshold * 1.2),
    fdTicks: FD_TICKS,
    width,
    rowY,
    groupY,
    height: y,
    bandExtra,
    pendingY,
  };
}

/** Rows of the focus band around `row`, with their heights. */
export function focusBand(
  layout: CoverageLayout,
  rowCount: number,
  row: number,
): {
  rows: Array<{ row: number; y: number; height: number }>;
  top: number;
  bottom: number;
  extra: number;
} {
  const first = Math.max(0, row - FOCUS_REACH);
  const last = Math.min(rowCount - 1, row + FOCUS_REACH);
  const top = layout.rowY[first];
  const bottom = layout.rowY[last] + layout.rowPx;
  const rows: Array<{ row: number; y: number; height: number }> = [];
  let y = top;
  for (let r = first; r <= last; r++) {
    const distance = Math.abs(r - row);
    const height = FOCUS_BAND.find((band) => distance <= band.upTo)?.height ?? layout.rowPx;
    rows.push({ row: r, y, height });
    y += height;
  }
  return { rows, top, bottom, extra: y - bottom };
}

export interface CoveragePaths {
  band: string;
  spark: string;
  sparkHot: string;
  hairline: string;
  hairlineHot: string;
  dash: string;
  content: string;
  error: string;
  errorInk: string;
  variant: string;
  struck: string;
  /** Solid marks of compressed rows. */
  quiet: string;
  quietVariant: string;
  quietHot: string;
  fdDot: string;
  fdDotHot: string;
  fdHollow: string;
  fdHollowHot: string;
  fdTick: string;
  fdTickHot: string;
  derivHalf: string;
  derivRing: string;
  derivMissing: string;
  derivStale: string;
  derivUnrecorded: string;
  derivTick: string;
  /** A remote file not mirrored here: neither present nor missing. */
  unknown: string;
  /** FD above the shared scale: a tick at the top of the cell. */
  sparkClip: string;
}

const EMPTY_PATHS: CoveragePaths = {
  band: '',
  spark: '',
  sparkHot: '',
  hairline: '',
  hairlineHot: '',
  dash: '',
  content: '',
  error: '',
  errorInk: '',
  variant: '',
  struck: '',
  quiet: '',
  quietVariant: '',
  quietHot: '',
  fdDot: '',
  fdDotHot: '',
  fdHollow: '',
  fdHollowHot: '',
  fdTick: '',
  fdTickHot: '',
  derivHalf: '',
  derivRing: '',
  derivMissing: '',
  derivStale: '',
  derivUnrecorded: '',
  derivTick: '',
  unknown: '',
  sparkClip: '',
};

const n = (value: number) => Math.round(value * 10) / 10;
const rect = (x: number, y: number, w: number, h: number) =>
  `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}z`;
const circle = (cx: number, cy: number, r: number) =>
  `M${n(cx - r)} ${n(cy)}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0z`;

/** A tick at the top of the cell for each stretch the scale cuts off. */
function clipTicks(trace: readonly number[], x: number, y: number, w: number): string {
  let d = '';
  const last = Math.max(trace.length - 1, 1);
  trace.forEach((value, i) => {
    if (value > FD_SPARK_MAX_MM && !(trace[i - 1] > FD_SPARK_MAX_MM)) d += `M${n(x + (i / last) * w)} ${n(y - 2)}v2`;
  });
  return d;
}

function sparkline(trace: readonly number[], x: number, y: number, w: number, h: number): string {
  let d = '';
  const last = Math.max(trace.length - 1, 1);
  trace.forEach((value, i) => {
    const px = x + (i / last) * w;
    const py = y + h - (Math.min(value, FD_SPARK_MAX_MM) / FD_SPARK_MAX_MM) * h;
    d += `${i === 0 ? 'M' : 'L'}${n(px)} ${n(py)}`;
  });
  return d;
}

function paintDetailedCell(p: CoveragePaths, cell: BidsCell, x: number, y: number, w: number, h: number) {
  const insetX = w / 6;
  const insetY = (h * 3) / 16;
  const ix = x + insetX;
  const iy = y + insetY;
  const iw = w - insetX * 2;
  const ih = h - insetY * 2;
  const cx = x + w / 2;
  const cy = y + h / 2;
  switch (cell.mark) {
    case 'unread':
      return;
    case 'missing':
      p.dash += `M${n(cx - 3)} ${n(cy)}h6`;
      return;
    case 'unknown':
      p.unknown += circle(cx, cy, 0.8);
      return;
    case 'error': {
      p.error += rect(ix, iy, iw, ih);
      const arm = Math.min(3, ih / 2 - 0.5);
      p.errorInk += `M${n(cx - arm)} ${n(cy - arm)}l${n(arm * 2)} ${n(arm * 2)}M${n(cx + arm)} ${n(cy - arm)}l${n(-arm * 2)} ${n(arm * 2)}`;
      break;
    }
    case 'content':
      p.content += rect(ix, iy, iw, ih);
      break;
    case 'spark': {
      const line = sparkline(cell.trace ?? [], ix, iy, iw, ih);
      p.sparkClip += clipTicks(cell.trace ?? [], ix, iy, iw);
      if (cell.hot) p.sparkHot += line;
      else p.spark += line;
      break;
    }
    case 'hairline': {
      const line = `M${n(ix)} ${n(cy)}h${n(iw)}`;
      if (cell.hot) p.hairlineHot += line;
      else p.hairline += line;
      break;
    }
  }
  if (cell.variant) p.variant += rect(x + 3.5, y + 1.5, w - 7, h - 3);
  if (cell.excluded) p.struck += `M${n(x + 3)} ${n(y + h - 2)}L${n(x + w - 3)} ${n(y + 2)}`;
}

function paintDenseCell(p: CoveragePaths, cell: BidsCell, x: number, y: number, w: number, h: number) {
  if (!cell.runId) return;
  const ix = x + 1;
  const iw = w - 2;
  const fill = Math.max(1, h - 1);
  if (cell.mark === 'error') {
    // The full row height with a notch: a shape that survives at 3 px.
    p.error += rect(ix, y, iw, h);
    p.errorInk += rect(x + w / 2 - 1, y + Math.floor((h - 1) / 2), 2, 1);
  } else if (cell.mark === 'content') {
    p.content += rect(ix, y, iw, fill);
  } else if (cell.excluded) {
    p.dash += `M${n(ix)} ${n(y + 0.5)}h${n(iw)}`;
  } else if (cell.hot) {
    p.quietHot += rect(ix, y, iw, fill);
  } else if (cell.variant) {
    p.quietVariant += rect(ix, y, iw, fill);
  } else {
    p.quiet += rect(ix, y, iw, fill);
  }
}

function paintFd(p: CoveragePaths, layout: CoverageLayout, fd: BidsSessionFd[], y: number, h: number) {
  const cy = y + h / 2;
  fd.forEach((entry, i) => {
    if (entry.mean === null) return;
    const x = fdX(layout, i, entry.mean);
    if (h < SPARK_MIN_ROW_PX) {
      // The compressed dot strip: a tick, hollow groups a shorter one.
      const tick = entry.hollow ? `M${n(x - 1)} ${n(y + 0.5)}h2` : rect(x - 1, y, 2, Math.max(1, h - 1));
      if (entry.over) p.fdTickHot += tick;
      else p.fdTick += tick;
    } else if (entry.hollow) {
      const dot = circle(x, cy, entry.over ? 3 : 2.3);
      if (entry.over) p.fdHollowHot += dot;
      else p.fdHollow += dot;
    } else if (entry.over) {
      p.fdDotHot += circle(x, cy, 3);
    } else {
      p.fdDot += circle(x, cy, 2.3);
    }
  });
}

function paintDerivatives(p: CoveragePaths, model: BidsModel, layout: CoverageLayout, row: BidsMatrixRow, y: number, h: number) {
  const cy = y + h / 2;
  model.derivativeColumns.forEach((derivative, i) => {
    const status = row.derivatives[derivative.name];
    if (!status || status === 'current' || status === 'no_local_data') return;
    const x = layout.derivX + i * layout.derivW + 6;
    if (status === 'unrecorded') {
      if (h >= SPARK_MIN_ROW_PX) p.derivUnrecorded += circle(x, cy, 0.8);
    } else if (h < SPARK_MIN_ROW_PX) {
      p.derivTick += rect(x - 1, y, 2, Math.max(1, h - 1));
    } else if (status === 'partial') {
      p.derivHalf += `M${n(x)} ${n(cy - 3)}a3 3 0 0 1 0 6z`;
      p.derivRing += circle(x, cy, 3);
    } else if (status === 'missing') {
      p.derivMissing += circle(x, cy, 3);
    } else {
      p.derivStale += `${circle(x, cy, 3)}M${n(x - 2)} ${n(cy + 2)}l4 -4`;
    }
  });
}

/** Faint band behind contiguous cells of the lens. */
function paintBand(p: CoveragePaths, model: BidsModel, layout: CoverageLayout, rowIndex: number, y: number, h: number) {
  const nCols = model.columns.length;
  const base = rowIndex * nCols;
  let start = -1;
  for (let col = 0; col <= nCols; col++) {
    const on = col < nCols && model.cells[base + col].inLens;
    if (on && start < 0) start = col;
    if (!on && start >= 0) {
      const x0 = layout.colX[start];
      p.band += rect(x0, y, layout.colX[col - 1] + layout.colW - x0, h);
      start = -1;
    }
  }
}

/** All marks of `rows`, one path per style. `yOf` places a row. */
export function paintRows(
  model: BidsModel,
  layout: CoverageLayout,
  rows: ReadonlyArray<{ row: number; y: number; height: number }>,
): CoveragePaths {
  const p: CoveragePaths = { ...EMPTY_PATHS };
  const nCols = model.columns.length;
  for (const { row: rowIndex, y, height } of rows) {
    const row = model.rows[rowIndex];
    paintBand(p, model, layout, rowIndex, y, height);
    const base = rowIndex * nCols;
    for (let col = 0; col < nCols; col++) {
      const cell = model.cells[base + col];
      if (height >= SPARK_MIN_ROW_PX) paintDetailedCell(p, cell, layout.colX[col], y, layout.colW, height);
      else paintDenseCell(p, cell, layout.colX[col], y, layout.colW, height);
    }
    paintDerivatives(p, model, layout, row, y, height);
    paintFd(p, layout, row.sessionFd, y, height);
  }
  return p;
}

export function allRows(layout: CoverageLayout, count: number) {
  return Array.from({ length: count }, (_, row) => ({
    row,
    y: layout.rowY[row],
    height: layout.rowPx,
  }));
}

/** The row under `y` in the base layer, or null over a group header. */
export function rowAt(layout: CoverageLayout, y: number): number | null {
  let low = 0;
  let high = layout.rowY.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const top = layout.rowY[mid];
    if (y < top) high = mid - 1;
    else if (y >= top + layout.rowPx) low = mid + 1;
    else return mid;
  }
  return null;
}

export function columnAt(layout: CoverageLayout, x: number): number | null {
  let low = 0;
  let high = layout.colX.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const left = layout.colX[mid];
    if (x < left) high = mid - 1;
    else if (x >= left + layout.colW) low = mid + 1;
    else return mid;
  }
  return null;
}

/**
 * A header label short enough to clear its neighbours: stacked on three lines,
 * each may take three columns. The full name stays in the title.
 */
export function abbreviateLabel(text: string, widthPx: number, charPx: number): string {
  const chars = Math.max(2, Math.floor(widthPx / charPx));
  if (text.length <= chars) return text;
  // Both ends: tasks often differ at either one (overtverb… and covertverb…).
  const tail = Math.floor((chars - 1) / 2);
  return `${text.slice(0, chars - 1 - tail)}…${tail ? text.slice(-tail) : ''}`;
}

/**
 * Header labels placed left to right on stacked horizontal lines: a label that
 * would touch its neighbour drops to the next line. Never rotated.
 */
export function stackLabels(
  labels: ReadonlyArray<{ text: string; x: number }>,
  charPx: number,
  maxLines: number,
): Array<{ text: string; x: number; line: number }> {
  const lineEnds = new Array<number>(maxLines).fill(-Infinity);
  return labels.map(({ text, x }) => {
    let line = lineEnds.findIndex((end) => x >= end);
    if (line < 0) line = lineEnds.indexOf(Math.min(...lineEnds));
    lineEnds[line] = x + text.length * charPx + 4;
    return { text, x, line };
  });
}
