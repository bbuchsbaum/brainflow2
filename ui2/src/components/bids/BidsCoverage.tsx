/**
 * Coverage: one row per participant, one column per run. The cells are a single
 * memoized layer of paths (`CoverageBase`); selection is a separate scene that
 * moves over it, so J/K re-renders a few nodes however large the dataset is.
 * With many participants rows compress and a graduated focus band opens at the
 * selection: the base layer is shown twice, clipped above and below the band.
 */
import React, { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { selectBidsModel, useBidsModel, useBidsStore } from '@/stores/bidsStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import {
  EXCLUDED_MEAN_NOTE,
  FD_SPARK_MAX_MM,
  SESSION_MEAN_NOTE,
  type BidsModel,
} from '@/stores/bidsModel';
import { openSelectedRun } from '@/services/bids/openRunInViewer';
import {
  ROW_PX,
  abbreviateLabel,
  allRows,
  buildCoverageLayout,
  columnAt,
  fdX,
  focusBand,
  paintRows,
  rowAt,
  stackLabels,
  type CoverageLayout,
  type CoveragePaths,
} from './coverageGeometry';

const MONO = 'var(--bf-font-mono)';
const SANS = 'var(--bf-font-sans)';
const SIZE_XS = 'var(--bf-text-xs)';
const SIZE_2XS = 'var(--bf-text-2xs)';
const INK_SELECTED_CELL = 0.22;
const SELECTED_LABEL_PX = 54;
const LABEL_CHAR_PX = 6;
const LABEL_LINE_PX = 12;
const MAX_LABEL_LINES = 3;

interface PathStyle {
  key: keyof CoveragePaths;
  style: React.CSSProperties;
}

const stroke = (color: string, width: number, extra: React.CSSProperties = {}) => ({
  fill: 'none',
  stroke: color,
  strokeWidth: width,
  ...extra,
});
const fill = (color: string, extra: React.CSSProperties = {}) => ({ fill: color, ...extra });

const FAINT = 'var(--bf-text-faint)';
const MUTED = 'var(--bf-text-muted)';
const PRIMARY = 'var(--bf-text-primary)';

/** Paint order is meaning order: quiet first, anomalies on top. */
const PATH_STYLES: PathStyle[] = [
  // Behind the cells, and strong enough to find at a glance (native test 12).
  { key: 'band', style: fill('var(--bf-border-strong)', { fillOpacity: 0.55 }) },
  { key: 'quiet', style: fill('var(--bf-bg-active)') },
  { key: 'quietVariant', style: fill('var(--bf-border-strong)') },
  { key: 'spark', style: stroke(FAINT, 0.8) },
  { key: 'hairline', style: stroke(FAINT, 1) },
  { key: 'dash', style: stroke(FAINT, 1, { strokeOpacity: 0.5 }) },
  // One step lighter than round 3: quieter than any finding.
  { key: 'variant', style: stroke(FAINT, 0.5, { strokeOpacity: 0.7 }) },
  { key: 'content', style: fill('var(--bf-warning)') },
  { key: 'error', style: fill('var(--bf-danger)') },
  { key: 'errorInk', style: { fill: 'var(--bf-text-inverse)', stroke: 'var(--bf-text-inverse)', strokeWidth: 1.6 } },
  { key: 'quietHot', style: fill(PRIMARY) },
  { key: 'sparkHot', style: stroke(PRIMARY, 1.2) },
  { key: 'hairlineHot', style: stroke(PRIMARY, 1.2) },
  { key: 'sparkClip', style: stroke(PRIMARY, 1.2) },
  { key: 'struck', style: stroke('var(--bf-text-secondary)', 1) },
  { key: 'fdDot', style: fill(MUTED, { fillOpacity: 0.7 }) },
  { key: 'fdDotHot', style: fill(PRIMARY) },
  { key: 'fdHollow', style: stroke(MUTED, 1) },
  { key: 'fdHollowHot', style: stroke(PRIMARY, 1) },
  { key: 'fdTick', style: fill(MUTED) },
  { key: 'fdTickHot', style: fill(PRIMARY) },
  { key: 'derivHalf', style: fill(PRIMARY) },
  { key: 'derivRing', style: stroke(PRIMARY, 1) },
  { key: 'derivMissing', style: stroke(MUTED, 1, { strokeDasharray: '1.5 1.5' }) },
  { key: 'derivStale', style: stroke(FAINT, 0.75) },
  { key: 'derivUnrecorded', style: fill(FAINT) },
  { key: 'derivTick', style: fill(FAINT) },
  { key: 'unknown', style: fill(FAINT) },
];

function PathLayer({ paths }: { paths: CoveragePaths }) {
  return (
    <>
      {PATH_STYLES.map(({ key, style }) =>
        paths[key] ? <path key={key} data-mark={key} d={paths[key]} style={style} /> : null,
      )}
    </>
  );
}

function CoverageText({
  x,
  y,
  size = SIZE_XS,
  mono = false,
  color = MUTED,
  anchor,
  title,
  children,
}: {
  x: number;
  y: number;
  size?: string;
  mono?: boolean;
  color?: string;
  anchor?: 'middle' | 'end';
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      style={{ fill: color, fontSize: size, fontFamily: mono ? MONO : SANS }}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </text>
  );
}

// ---------------------------------------------------------------------------
// Base layer: every cell, once
// ---------------------------------------------------------------------------

const CoverageBase = memo(function CoverageBase({
  id,
  model,
  layout,
}: {
  id: string;
  model: BidsModel;
  layout: CoverageLayout;
}) {
  const paths = useMemo(
    () => paintRows(model, layout, allRows(layout, model.rows.length)),
    [model, layout],
  );
  const pending = useMemo(() => {
    if (layout.pendingY === null) return '';
    const y = layout.pendingY;
    return layout.colX.map((x) => `M${x + 1} ${y}h${layout.colW - 2}v${Math.min(layout.rowPx, 3)}h${2 - layout.colW}z`).join('');
  }, [layout]);

  return (
    <g id={id}>
      {layout.groupY.map((group) => (
        <g key={group.label}>
          <CoverageText x={6} y={group.y + 12}>
            {group.label}{' '}
            <tspan style={{ fill: FAINT, fontFamily: MONO }}>{group.count}</tspan>
          </CoverageText>
          <line
            x1={6}
            x2={layout.width - 6}
            y1={group.y + 15.5}
            y2={group.y + 15.5}
            style={{ stroke: 'var(--bf-border-subtle)' }}
          />
        </g>
      ))}
      {!layout.compressed &&
        model.rows.map((row) => {
          const y = layout.rowY[row.index] + ROW_PX / 2 + 4;
          return (
            <g key={row.subject}>
              <CoverageText
                x={6}
                y={y}
                mono
                color={row.inLens ? PRIMARY : 'var(--bf-text-secondary)'}
              >
                {row.label}
              </CoverageText>
              {(row.sex || row.age) && (
                <CoverageText x={64} y={y} size={SIZE_2XS} mono color={FAINT}>
                  {[row.sex, row.age].filter(Boolean).join(' ')}
                </CoverageText>
              )}
              {row.isNew && (
                <CoverageText x={92} y={y} size={SIZE_2XS} color="var(--bf-info)">
                  new
                </CoverageText>
              )}
              {row.sessionFd.map((entry, i) =>
                entry.over && entry.mean !== null ? (
                  <CoverageText
                    key={entry.session ?? 'none'}
                    x={fdX(layout, i, entry.mean) + 6}
                    y={y}
                    size={SIZE_2XS}
                    mono
                    color={PRIMARY}
                  >
                    {entry.mean.toFixed(2)}
                  </CoverageText>
                ) : null,
              )}
            </g>
          );
        })}
      <PathLayer paths={paths} />
      {pending && <path d={pending} style={fill('var(--bf-border-subtle)')} />}
      {layout.pendingY !== null && (
        <CoverageText x={layout.matrixEnd + 12} y={layout.pendingY + 9} size={SIZE_2XS} color="var(--bf-text-secondary)">
          reading…
        </CoverageText>
      )}
    </g>
  );
});

// ---------------------------------------------------------------------------
// Selection scene: all that moves
// ---------------------------------------------------------------------------

function ThresholdLines({ model, layout, height }: { model: BidsModel; layout: CoverageLayout; height: number }) {
  if (!model.summary.hasFd) return null;
  return (
    <>
      {model.sessions.map((session, i) => {
        const x = fdX(layout, i, model.fdThreshold);
        return (
          <line
            key={session ?? 'none'}
            x1={x}
            x2={x}
            y1={0}
            y2={height}
            style={{ stroke: FAINT, strokeDasharray: '2 3' }}
          />
        );
      })}
    </>
  );
}

function SelectedRowLabel({ model, row, y, height }: { model: BidsModel; row: number; y: number; height: number }) {
  return (
    <>
      <rect x={2} y={y} width={SELECTED_LABEL_PX} height={height} style={fill('var(--bf-bg-selected)')} />
      <CoverageText x={6} y={y + height / 2 + 4} mono color={PRIMARY}>
        {model.rows[row].label}
      </CoverageText>
    </>
  );
}

const CoverageScene = memo(function CoverageScene({
  baseId,
  model,
  layout,
  scroller,
  headerPx,
  footerPx,
}: {
  baseId: string;
  model: BidsModel;
  layout: CoverageLayout;
  scroller: React.RefObject<HTMLDivElement | null>;
  headerPx: number;
  footerPx: number;
}) {
  const selectedRunId = useBidsStore((state) => state.selectedRunId);
  const position = selectedRunId ? model.runPosition.get(selectedRunId) : undefined;
  const clipId = useId();
  const band = useMemo(
    () => (layout.compressed && position ? focusBand(layout, model.rows.length, position.row) : null),
    [layout, model.rows.length, position],
  );
  const bandPaths = useMemo(
    () => (band ? paintRows(model, layout, band.rows) : null),
    [band, model, layout],
  );

  const selectedRow = position?.row;
  const selectedY = band
    ? band.rows.find((entry) => entry.row === selectedRow)?.y
    : selectedRow !== undefined
      ? layout.rowY[selectedRow]
      : undefined;
  const selectedHeight = band
    ? (band.rows.find((entry) => entry.row === selectedRow)?.height ?? ROW_PX)
    : ROW_PX;

  useEffect(() => {
    const el = scroller.current;
    if (!el || selectedY === undefined) return;
    const top = selectedY + headerPx;
    const bottom = top + selectedHeight;
    if (top - headerPx < el.scrollTop) el.scrollTop = top - headerPx;
    else if (bottom + footerPx > el.scrollTop + el.clientHeight) {
      el.scrollTop = bottom + footerPx - el.clientHeight;
    }
  }, [selectedY, selectedHeight, scroller, headerPx, footerPx]);

  const total = layout.height + layout.bandExtra;
  const cellX = position ? layout.colX[position.col] : 0;
  const selectedBackdrop =
    selectedY !== undefined ? (
      <>
        <rect x={0} y={selectedY} width={layout.width} height={selectedHeight} style={fill('var(--bf-bg-selected)')} />
        <rect
          x={cellX + 2}
          y={selectedY + 1}
          width={layout.colW - 4}
          height={selectedHeight - 2}
          style={fill(PRIMARY, { fillOpacity: INK_SELECTED_CELL })}
        />
      </>
    ) : null;
  const selectedEdge =
    selectedY !== undefined ? (
      <rect
        data-testid="bids-selected-edge"
        x={0}
        y={selectedY}
        width={2}
        height={selectedHeight}
        className="fill-bf-accent"
      />
    ) : null;

  return (
    <>
      {selectedBackdrop}
      <ThresholdLines model={model} layout={layout} height={total} />
      {band ? (
        <>
          <clipPath id={`${clipId}-top`}>
            <rect x={0} y={0} width={layout.width} height={band.top} />
          </clipPath>
          <clipPath id={`${clipId}-bottom`}>
            <rect x={0} y={band.bottom} width={layout.width} height={layout.height} />
          </clipPath>
          <g clipPath={`url(#${clipId}-top)`}>
            <use href={`#${baseId}`} />
          </g>
          <g transform={`translate(0 ${band.extra})`}>
            <g clipPath={`url(#${clipId}-bottom)`}>
              <use href={`#${baseId}`} />
            </g>
          </g>
          <g data-testid="bids-focus-band">
            {bandPaths && <PathLayer paths={bandPaths} />}
            {band.rows
              .filter((entry) => entry.height >= 10)
              .map((entry) => (
                <CoverageText
                  key={entry.row}
                  x={6}
                  y={entry.y + entry.height / 2 + 3.5}
                  size={SIZE_2XS}
                  mono
                  color={MUTED}
                >
                  {model.rows[entry.row].label}
                </CoverageText>
              ))}
          </g>
        </>
      ) : (
        <use href={`#${baseId}`} />
      )}
      {selectedRow !== undefined && selectedY !== undefined && (
        <SelectedRowLabel model={model} row={selectedRow} y={selectedY} height={selectedHeight} />
      )}
      {selectedEdge}
    </>
  );
});

// ---------------------------------------------------------------------------
// Header, totals, legend
// ---------------------------------------------------------------------------

/**
 * `epi AP` beside `epi PA`: one heading, the entity in the run row. A single
 * column keeps its whole label.
 */
function splitSeries(columns: BidsModel['columns'], i: number): [string, string] | null {
  const [head, ...rest] = columns[i].seriesLabel.split(' ');
  if (rest.length === 0) return null;
  const paired = columns.some(
    (other) =>
      other.session === columns[i].session &&
      other.series !== columns[i].series &&
      other.seriesLabel.startsWith(`${head} `),
  );
  return paired ? [head, rest.join(' ')] : null;
}

function seriesSpans(model: BidsModel, layout: CoverageLayout) {
  const spans: Array<{ text: string; x: number; width: number }> = [];
  let start = 0;
  model.columns.forEach((column, i) => {
    const next = model.columns[i + 1];
    const text = splitSeries(model.columns, i)?.[0] ?? column.seriesLabel;
    const nextText = next ? (splitSeries(model.columns, i + 1)?.[0] ?? next.seriesLabel) : null;
    const sameRun = next?.series === column.series;
    if (next && next.session === column.session && (sameRun || nextText === text)) return;
    const x = layout.colX[start];
    spans.push({ text, x, width: layout.colX[i] + layout.colW - x });
    start = i + 1;
  });
  return spans;
}

function useHeaderLabels(model: BidsModel, layout: CoverageLayout) {
  return useMemo(() => {
    const spans = seriesSpans(model, layout);
    const placed = spans.map((span) => {
      const room = Math.min(
        Math.max(span.width, layout.colW * MAX_LABEL_LINES) - 4,
        layout.derivX - span.x - 4,
      );
      const text = abbreviateLabel(span.text, room, LABEL_CHAR_PX);
      return {
        text,
        full: span.text,
        x: Math.max(span.x, span.x + span.width / 2 - (text.length * LABEL_CHAR_PX) / 2),
      };
    });
    const labels = stackLabels(placed, LABEL_CHAR_PX, MAX_LABEL_LINES).map((label, i) => ({
      ...label,
      full: placed[i].full,
    }));
    const lines = Math.max(1, ...labels.map((label) => label.line + 1));
    return { labels, lines, height: 28 + lines * LABEL_LINE_PX + 26 };
  }, [model, layout]);
}

/** The clip is part of the scale's statement, not a footnote to it. */
const scaleNote = ({ runs, maxMm }: BidsModel['sparkClip']) =>
  `bold cells: FD per volume, 0–${FD_SPARK_MAX_MM} mm, shared scale` +
  (runs ? `; ${runs} clipped, max ${maxMm.toFixed(2)} mm` : '');

const CoverageHeader = memo(function CoverageHeader({
  model,
  layout,
  labels,
  lines,
  height,
}: {
  model: BidsModel;
  layout: CoverageLayout;
  labels: Array<ReturnType<typeof stackLabels>[number] & { full: string }>;
  lines: number;
  height: number;
}) {
  const sessions = useMemo(() => {
    const spans: Array<{ session: string; x0: number; x1: number }> = [];
    model.columns.forEach((column, i) => {
      const last = spans[spans.length - 1];
      const x1 = layout.colX[i] + layout.colW;
      if (last && last.session === (column.session ?? '')) last.x1 = x1;
      else spans.push({ session: column.session ?? '', x0: layout.colX[i], x1 });
    });
    return spans;
  }, [model.columns, layout]);
  const runY = 28 + lines * LABEL_LINE_PX;
  const hasFd = model.summary.hasFd;

  return (
    <svg
      width={layout.width}
      height={height}
      className="sticky top-0 z-[1] block bg-bf-bg-panel"
      aria-hidden="true"
      style={{ fontFamily: SANS }}
    >
      {sessions.map((span) => (
        <g key={span.session}>
          {span.session && (
            <CoverageText x={span.x0 + 3} y={11} mono color="var(--bf-text-secondary)">
              ses-{span.session.replace(/^ses-/, '')}
            </CoverageText>
          )}
          <line x1={span.x0 + 3} x2={span.x1 - 3} y1={16} y2={16} style={{ stroke: 'var(--bf-border)' }} />
        </g>
      ))}
      {labels.map((label) => (
        <CoverageText
          key={`${label.x}:${label.text}`}
          x={label.x}
          y={30 + label.line * LABEL_LINE_PX}
          title={label.full === label.text ? undefined : label.full}
        >
          {label.text}
        </CoverageText>
      ))}
      {model.columns.map((column, i) =>
        (column.runLabel || splitSeries(model.columns, i)) && !layout.compressed ? (
          <CoverageText
            key={column.key}
            x={layout.colX[i] + layout.colW / 2}
            y={runY}
            size={SIZE_2XS}
            mono
            color={FAINT}
            anchor="middle"
          >
            {[splitSeries(model.columns, i)?.[1], column.runLabel].filter(Boolean).join(' ')}
          </CoverageText>
        ) : null,
      )}
      <CoverageText x={6} y={runY} size={SIZE_2XS} color={FAINT}>
        participant
      </CoverageText>
      {!layout.compressed && (
        <CoverageText x={62} y={runY} size={SIZE_2XS} color={FAINT}>
          sex age
        </CoverageText>
      )}
      {model.columns.some((column) => column.isBold) && (
        <CoverageText x={layout.matrixX + 3} y={runY + 14} size={SIZE_2XS} color={FAINT}>
          {scaleNote(model.sparkClip)}
        </CoverageText>
      )}
      {model.derivativeColumns.length > 0 && (
        <CoverageText x={layout.derivX} y={30}>
          deriv.
        </CoverageText>
      )}
      {model.derivativeColumns.map((derivative, i) => (
        <CoverageText
          key={derivative.name}
          x={layout.derivX + i * layout.derivW + 6}
          y={runY}
          size={SIZE_2XS}
          mono
          color={FAINT}
          anchor="middle"
        >
          {derivativeAbbreviation(derivative.name)}
        </CoverageText>
      ))}
      {hasFd && (
        <>
          <CoverageText x={layout.fdX} y={11} size={SIZE_2XS} color={FAINT}>
            {SESSION_MEAN_NOTE}
          </CoverageText>
          <CoverageText x={layout.fdX} y={runY + 14} size={SIZE_2XS} color={FAINT}>
            {EXCLUDED_MEAN_NOTE}
          </CoverageText>
          {model.sessions.map((session, i) => (
            <g key={session ?? 'none'}>
              <CoverageText x={layout.fdX + i * (layout.fdW + layout.fdGap)} y={30}>
                {session ? `ses-${session.replace(/^ses-/, '')}` : 'runs'}
              </CoverageText>
              {layout.fdTicks.map((tick) => (
                <CoverageText
                  key={tick}
                  x={fdX(layout, i, tick)}
                  y={runY}
                  size={SIZE_2XS}
                  mono
                  anchor="middle"
                  color={tick === model.fdThreshold ? 'var(--bf-text-secondary)' : FAINT}
                >
                  {tick === 0 ? '0' : String(tick).replace('0.', '.')}
                </CoverageText>
              ))}
            </g>
          ))}
        </>
      )}
    </svg>
  );
});

function derivativeAbbreviation(name: string): string {
  const known: Record<string, string> = { fmriprep: 'fp', mriqc: 'qc', freesurfer: 'fs' };
  return known[name.toLowerCase()] ?? name.slice(0, 2);
}

const CoverageTotals = memo(function CoverageTotals({ model, layout, height }: { model: BidsModel; layout: CoverageLayout; height: number }) {
  return (
    <svg
      width={layout.width}
      height={height}
      className="sticky bottom-0 z-[1] block bg-bf-bg-panel"
      data-testid="bids-coverage-totals"
    >
      <line x1={6} x2={layout.derivX - 8} y1={1.5} y2={1.5} style={{ stroke: 'var(--bf-border)' }} />
      <CoverageText x={6} y={15} size={SIZE_2XS} color={FAINT}>
        {model.absenceKnown
          ? `runs present, of ${model.columnTotalOf}`
          : 'no totals: only fetched files were read'}
      </CoverageText>
      {model.absenceKnown && model.columns.map((column, i) => (
        <CoverageText
          key={column.key}
          x={layout.colX[i] + layout.colW / 2}
          // Narrow columns take turns on two lines, like the headers.
          y={layout.compressed && i % 2 === 1 ? 27 : 15}
          size={SIZE_2XS}
          mono
          anchor="middle"
          color={column.total < model.columnTotalOf ? 'var(--bf-text-secondary)' : FAINT}
        >
          {column.total}
        </CoverageText>
      ))}
    </svg>
  );
});

function LegendItem({ glyph, children }: { glyph: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {glyph}
      {children}
    </span>
  );
}

function fdCaveatText(model: BidsModel): string | null {
  const hollow = model.fdHollow;
  if (!hollow) return null;
  return `hollow FD dot: this session's runs are ${hollow.others.join('; ')}, unlike most (${hollow.modal}); FD is unfiltered, so compare within group`;
}

const CoverageLegend = memo(function CoverageLegend({ model, compressed }: { model: BidsModel; compressed: boolean }) {
  const caveat = fdCaveatText(model);
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-1.5 pt-2 pb-1 text-bf-xs text-bf-text-muted" data-testid="bids-coverage-legend">
      <LegendItem glyph={<svg width="26" height="10" aria-hidden="true"><polyline points="0,8 5,7 9,8 13,6 17,8 21,7 26,8" style={stroke(FAINT, 0.8)} /></svg>}>bold run</LegendItem>
      {model.sparkClip.runs > 0 ? (
        <LegendItem glyph={<svg width="12" height="10" aria-hidden="true"><path d="M6 0v3" style={stroke(PRIMARY, 1.2)} /><polyline points="0,9 4,8 6,3 8,8 12,9" style={stroke(FAINT, 0.8)} /></svg>}>
          {model.sparkClip.runs} clipped: tick where FD passes {FD_SPARK_MAX_MM} mm
        </LegendItem>
      ) : null}
      <LegendItem glyph={<svg width="26" height="10" aria-hidden="true"><polyline points="0,8 5,7 9,1 13,7 17,8 21,2 26,8" style={stroke(PRIMARY, 1.2)} /></svg>}>run mean FD over threshold</LegendItem>
      <LegendItem glyph={<svg width="26" height="12" aria-hidden="true"><rect x=".5" y=".5" width="25" height="11" style={stroke(FAINT, 0.5, { strokeOpacity: 0.7 })} /></svg>}>acquisition variant</LegendItem>
      <LegendItem glyph={<svg width="20" height="10" aria-hidden="true"><rect width="20" height="10" style={fill('var(--bf-warning)')} /></svg>}>content problem</LegendItem>
      <LegendItem glyph={<svg width="20" height="10" aria-hidden="true"><rect width="20" height="10" style={fill('var(--bf-danger)')} /><path d="M7 2l6 6M13 2l-6 6" style={stroke('var(--bf-text-inverse)', 1.6)} /></svg>}>validation error</LegendItem>
      <LegendItem glyph={<svg width="20" height="10" aria-hidden="true"><path d="M2 9L18 1" style={stroke('var(--bf-text-secondary)', 1)} /></svg>}>excluded, not counted</LegendItem>
      {caveat && (
        <LegendItem glyph={<svg width="12" height="10" aria-hidden="true"><circle cx="6" cy="5" r="2.6" style={stroke(MUTED, 1)} /></svg>}>{caveat}</LegendItem>
      )}
      {model.derivativeColumns.length > 0 && model.absenceKnown && (
        <LegendItem glyph={<svg width="12" height="10" aria-hidden="true"><circle cx="6" cy="5" r="3" style={stroke(MUTED, 1, { strokeDasharray: '1.5 1.5' })} /></svg>}>derivative not run (blank = present and current)</LegendItem>
      )}
      {model.rows.some((row) => Object.values(row.derivatives).includes('unrecorded')) && (
        <LegendItem glyph={<svg width="12" height="10" aria-hidden="true"><circle cx="6" cy="5" r="0.8" style={fill(FAINT)} /></svg>}>derivative present, source version not recorded</LegendItem>
      )}
      {!model.absenceKnown && (
        <LegendItem glyph={<svg width="12" height="10" aria-hidden="true"><circle cx="6" cy="5" r="0.8" style={fill(FAINT)} /></svg>}>not fetched from the server: unknown, not missing</LegendItem>
      )}
      {model.participants.noLocalData > 0 && (
        <span className="text-bf-text-faint" data-testid="bids-no-local-data">
          {model.participants.noLocalData} listed in participants.tsv with no images here: not shown and not counted.
        </span>
      )}
      {compressed && (
        <span className="text-bf-text-faint">
          Rows are compressed; sparklines appear in the focus band around the selection. Rows not yet read are empty, never estimated.
        </span>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

/** Whole rows only: snap points on the row grid, and a height of whole rows. */
const CoverageSnapPoints = memo(function CoverageSnapPoints({ rows, headerPx }: { rows: number[]; headerPx: number }) {
  return (
    <>
      {rows.map((y) => (
        <div
          key={y}
          aria-hidden="true"
          className="absolute left-0 h-px w-px"
          style={{ top: y, scrollSnapAlign: 'start', scrollMarginTop: headerPx }}
        />
      ))}
    </>
  );
});

const TOTALS_PX = 20;
const TOTALS_COMPRESSED_PX = 32;

/** Holds its value while `frozen`: a hidden tab does not repaint on every scan flush. */
function useFrozenWhile<T>(value: T, frozen: boolean): T {
  const [held, setHeld] = useState(value);
  useEffect(() => {
    if (!frozen) setHeld(value);
  }, [value, frozen]);
  return frozen ? held : value;
}

export function BidsCoverage() {
  const liveModel = useBidsModel();
  const hidden = useWorkspaceStore((state) => {
    const type = state.getActiveWorkspace?.()?.type;
    return type !== undefined && type !== 'bids-explorer';
  });
  const model = useFrozenWhile(liveModel, hidden);
  const selectRun = useBidsStore((state) => state.selectRun);
  const [frameWidth, setFrameWidth] = useState(0);
  const layout = useMemo(() => buildCoverageLayout(model, frameWidth), [model, frameWidth]);
  const { labels, lines, height: headerPx } = useHeaderLabels(model, layout);
  const totalsPx = layout.compressed ? TOTALS_COMPRESSED_PX : TOTALS_PX;
  const baseId = useId();
  const scroller = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [fitHeight, setFitHeight] = useState<number | null>(null);

  useEffect(() => {
    const el = frame.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => setFrameWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = frame.current;
    if (!el || layout.compressed || typeof ResizeObserver === 'undefined') {
      setFitHeight(null);
      return;
    }
    const update = () => {
      const free = el.clientHeight - headerPx - totalsPx;
      const fit = Math.floor(free / ROW_PX) * ROW_PX + headerPx + totalsPx;
      setFitHeight(fit > 0 ? fit : null);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [layout.compressed, headerPx, totalsPx]);

  const handleClick = useCallback(
    (event: React.MouseEvent<SVGSVGElement>) => {
      const box = event.currentTarget.getBoundingClientRect();
      const state = useBidsStore.getState();
      const current = selectBidsModel(state);
      const position = state.selectedRunId ? current.runPosition.get(state.selectedRunId) : undefined;
      const x = event.clientX - box.left;
      const y = event.clientY - box.top;
      let row: number | null;
      if (layout.compressed && position) {
        const band = focusBand(layout, current.rows.length, position.row);
        const end = band.bottom + band.extra;
        row =
          y < band.top
            ? rowAt(layout, y)
            : y < end
              ? (band.rows.find((entry) => y >= entry.y && y < entry.y + entry.height)?.row ?? null)
              : rowAt(layout, y - band.extra);
      } else {
        row = rowAt(layout, y);
      }
      if (row === null) return;
      const nCols = current.columns.length;
      const col = columnAt(layout, x);
      if (col !== null) {
        const id = current.cells[row * nCols + col].runId;
        if (id) selectRun(id);
        return;
      }
      // The gutter selects the participant's first run.
      for (let c = 0; c < nCols; c++) {
        const id = current.cells[row * nCols + c].runId;
        if (id) {
          selectRun(id);
          return;
        }
      }
    },
    [layout, selectRun],
  );

  const handleDoubleClick = useCallback(() => openSelectedRun(), []);

  const snapRows = useMemo(() => {
    if (layout.compressed) return [];
    return [...layout.groupY.map((group) => group.y), ...layout.rowY];
  }, [layout]);

  const totalHeight = layout.height + layout.bandExtra;

  return (
    <div ref={frame} className="absolute inset-0 bg-bf-bg-panel">
      <div
        ref={scroller}
        tabIndex={0}
        role="group"
        aria-label="Coverage matrix"
        data-testid="bids-coverage"
        data-compressed={layout.compressed || undefined}
        className="w-full overflow-auto pl-1.5 focus-visible:outline focus-visible:outline-1 focus-visible:outline-bf-accent"
        style={{
          height: fitHeight ?? '100%',
          scrollSnapType: layout.compressed ? undefined : 'y proximity',
        }}
      >
        <CoverageHeader model={model} layout={layout} labels={labels} lines={lines} height={headerPx} />
        <div className="relative" style={{ width: layout.width, height: totalHeight }}>
          <CoverageSnapPoints rows={snapRows} headerPx={headerPx} />
          <svg
            width={layout.width}
            height={totalHeight}
            className="block cursor-pointer"
            data-testid="bids-coverage-matrix"
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
          >
            <defs>
              <CoverageBase id={baseId} model={model} layout={layout} />
            </defs>
            <CoverageScene
              baseId={baseId}
              model={model}
              layout={layout}
              scroller={scroller}
              headerPx={headerPx}
              footerPx={totalsPx}
            />
          </svg>
        </div>
        <CoverageTotals model={model} layout={layout} height={totalsPx} />
        <CoverageLegend model={model} compressed={layout.compressed} />
      </div>
    </div>
  );
}
