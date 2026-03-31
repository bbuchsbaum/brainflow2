import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useBidsStore } from '@/stores/bidsStore';
import type { BidsCoverageCell, BidsCoverageColumn } from '@/stores/bidsStore';
import { formatSubjectId } from '@/utils/bids';
import { getFileLoadingService } from '@/services/FileLoadingService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Compute opacity from run count: 1 run = 0.6, 2+ = scales up to 1.0 */
function runCountOpacity(count: number): number {
  if (count <= 0) return 0;
  if (count === 1) return 0.6;
  return Math.min(1, 0.6 + count * 0.1);
}

/** Check whether a cell matches the current selection */
function isCellSelected(
  subjectId: string,
  col: BidsCoverageColumn,
  selection: { subjectId: string | null; sessionId: string | null; modality: string | null },
): boolean {
  return (
    selection.subjectId === subjectId &&
    selection.sessionId === (col.session ?? null) &&
    selection.modality === col.modality
  );
}

// ---------------------------------------------------------------------------
// Tooltip state (simple CSS-based, no extra deps)
// ---------------------------------------------------------------------------

interface TooltipData {
  cell: BidsCoverageCell;
  col: BidsCoverageColumn;
  subject: string;
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// Session group computation
// ---------------------------------------------------------------------------

interface SessionGroup {
  session: string | null;
  startIdx: number;
  count: number;
}

function computeSessionGroups(columns: BidsCoverageColumn[]): SessionGroup[] {
  const groups: SessionGroup[] = [];
  let current: SessionGroup | null = null;
  for (let i = 0; i < columns.length; i++) {
    const sess = columns[i].session ?? null;
    if (!current || current.session !== sess) {
      current = { session: sess, startIdx: i, count: 1 };
      groups.push(current);
    } else {
      current.count++;
    }
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const CELL_HEIGHT = 24;
const HEADER_HEIGHT = 40;
const SESSION_HEADER_HEIGHT = 20;

/** Single data cell */
const DataCell = React.memo(function DataCell({
  cell,
  col,
  subject,
  selected,
  onMouseEnter,
  onMouseLeave,
  onClick,
}: {
  cell: BidsCoverageCell;
  col: BidsCoverageColumn;
  subject: string;
  selected: boolean;
  onMouseEnter: (e: React.MouseEvent, cell: BidsCoverageCell, col: BidsCoverageColumn, subject: string) => void;
  onMouseLeave: () => void;
  onClick: () => void;
}) {
  const handleEnter = useCallback(
    (e: React.MouseEvent) => onMouseEnter(e, cell, col, subject),
    [onMouseEnter, cell, col, subject],
  );

  const style: React.CSSProperties = {
    height: CELL_HEIGHT,
    minWidth: 40,
    borderRadius: 'var(--app-radius-sm)',
    cursor: 'pointer',
    transition: 'outline var(--app-transition-fast)',
  };

  if (cell.present && cell.run_count > 0) {
    style.background = `hsl(var(--primary) / ${runCountOpacity(cell.run_count)})`;
  } else {
    style.background = `repeating-linear-gradient(
      -45deg,
      hsl(var(--muted) / 0.3),
      hsl(var(--muted) / 0.3) 2px,
      transparent 2px,
      transparent 6px
    )`;
  }

  if (selected) {
    style.outline = '1px solid hsl(var(--accent))';
    style.outlineOffset = '-1px';
  }

  return (
    <div
      role="gridcell"
      aria-label={`${formatSubjectId(subject)} ${col.label} — ${cell.present ? `${cell.run_count} run(s)` : 'missing'}`}
      style={style}
      onMouseEnter={handleEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
    />
  );
});

/** Floating tooltip */
function CoverageTooltip({ data }: { data: TooltipData }) {
  const { cell, col, subject, x, y } = data;
  return (
    <div
      style={{
        position: 'fixed',
        left: x + 12,
        top: y - 8,
        zIndex: 9999,
        pointerEvents: 'none',
        background: 'hsl(var(--card))',
        color: 'hsl(var(--foreground))',
        border: '1px solid hsl(var(--border))',
        borderRadius: 'var(--app-radius-md)',
        padding: '6px 8px',
        fontSize: 'var(--app-text-xs)',
        fontFamily: 'var(--app-font-sans)',
        maxWidth: 280,
        lineHeight: 1.4,
      }}
    >
      <div style={{ fontWeight: 600 }}>
        {formatSubjectId(subject)} / {col.label}
      </div>
      {cell.present ? (
        <>
          <div style={{ marginTop: 2 }}>
            {cell.run_count} file{cell.run_count !== 1 ? 's' : ''} &middot; {formatBytes(cell.size_bytes)}
          </div>
          {cell.file_paths.length > 0 && (
            <div
              className="bf-role-mono"
              style={{
                marginTop: 3,
                fontSize: 10,
                opacity: 0.7,
                wordBreak: 'break-all',
              }}
            >
              {cell.file_paths.slice(0, 3).map((p) => {
                const parts = p.split('/');
                return parts.slice(-2).join('/');
              }).join(', ')}
              {cell.file_paths.length > 3 && ` +${cell.file_paths.length - 3} more`}
            </div>
          )}
        </>
      ) : (
        <div style={{ marginTop: 2, opacity: 0.6 }}>Missing</div>
      )}
    </div>
  );
}

/** Action bar shown when a present cell is selected */
function CellActionBar({
  cell,
  col,
  subject,
}: {
  cell: BidsCoverageCell;
  col: BidsCoverageColumn;
  subject: string;
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleOpen = useCallback(
    (path: string) => {
      setDropdownOpen(false);
      getFileLoadingService().loadFile(path, 'programmatic', 'new-workspace');
    },
    [],
  );

  if (!cell.present || cell.file_paths.length === 0) return null;

  const sessionLabel = col.session ? `ses-${col.session}` : '';
  const label = [formatSubjectId(subject), sessionLabel, col.label].filter(Boolean).join(' / ');

  return (
    <div
      className="flex items-center gap-3 border-t border-border px-4"
      style={{ height: 36, fontSize: 'var(--app-text-xs)' }}
    >
      <span className="bf-role-mono text-foreground/80" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {label} &mdash; {cell.run_count} file{cell.run_count !== 1 ? 's' : ''}, {formatBytes(cell.size_bytes)}
      </span>

      <div className="relative" ref={dropdownRef}>
        {cell.file_paths.length === 1 ? (
          <button
            type="button"
            className="bf-control-sm rounded-appsm border border-border bg-background px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-primary transition-colors hover:border-primary"
            onClick={() => handleOpen(cell.file_paths[0])}
          >
            Open in Viewer
          </button>
        ) : (
          <>
            <button
              type="button"
              className="bf-control-sm rounded-appsm border border-border bg-background px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-primary transition-colors hover:border-primary"
              onClick={() => setDropdownOpen((v) => !v)}
            >
              Open in Viewer &#x25BE;
            </button>
            {dropdownOpen && (
              <div
                className="absolute bottom-full left-0 mb-1 rounded-appsm border border-border bg-card"
                style={{ zIndex: 10, minWidth: 200, maxHeight: 200, overflowY: 'auto' }}
              >
                {cell.file_paths.map((fp) => {
                  const parts = fp.split('/');
                  const shortName = parts.slice(-2).join('/');
                  return (
                    <button
                      key={fp}
                      type="button"
                      className="bf-role-mono block w-full px-3 py-1.5 text-left text-[10px] text-foreground/80 transition-colors hover:bg-primary/10"
                      onClick={() => handleOpen(fp)}
                    >
                      {shortName}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function BidsCoverageMatrix() {
  const summary = useBidsStore((state) => state.summary);
  const selection = useBidsStore((state) => state.selection);
  const selectCell = useBidsStore((state) => state.selectCell);
  const setHoveredCell = useBidsStore((state) => state.setHoveredCell);

  const [tooltip, setTooltip] = useState<TooltipData | null>(null);

  // Derive session groups for multi-session datasets
  const sessionGroups = useMemo(() => {
    if (!summary) return [];
    return computeSessionGroups(summary.coverage.columns);
  }, [summary]);

  const hasMultipleSessions = sessionGroups.length > 1;

  // Determine the selected cell data for the action bar
  const selectedCellData = useMemo(() => {
    if (!summary || !selection.subjectId) return null;
    const { coverage } = summary;
    const rowIdx = coverage.subjects.indexOf(selection.subjectId);
    if (rowIdx < 0) return null;
    const colIdx = coverage.columns.findIndex(
      (c) => c.modality === selection.modality && (c.session ?? null) === selection.sessionId,
    );
    if (colIdx < 0) return null;
    return {
      cell: coverage.cells[rowIdx][colIdx],
      col: coverage.columns[colIdx],
      subject: coverage.subjects[rowIdx],
    };
  }, [summary, selection]);

  // Rotate headers when there are many columns
  const rotateHeaders = summary ? summary.coverage.columns.length > 8 : false;

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent, cell: BidsCoverageCell, col: BidsCoverageColumn, subject: string) => {
      const rowIdx = summary?.coverage.subjects.indexOf(subject) ?? -1;
      const colIdx = summary?.coverage.columns.indexOf(col) ?? -1;
      setHoveredCell({ row: rowIdx, col: colIdx });
      setTooltip({ cell, col, subject, x: e.clientX, y: e.clientY });
    },
    [summary, setHoveredCell],
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredCell(null);
    setTooltip(null);
  }, [setHoveredCell]);

  if (!summary) return null;

  const { coverage } = summary;
  const colCount = coverage.columns.length;

  // Build grid template columns:
  // For session gaps, we insert 8px spacer columns between session groups.
  // Column structure: [subject-label] [col0] [col1] ... [spacer?] [col2] ...
  const gridColumns: string[] = ['100px'];
  const columnMapping: { type: 'data'; colIdx: number }[] | { type: 'spacer' }[] = [];
  const flatMapping: Array<{ type: 'data'; colIdx: number } | { type: 'spacer' }> = [];

  for (let gi = 0; gi < sessionGroups.length; gi++) {
    const group = sessionGroups[gi];
    if (gi > 0 && hasMultipleSessions) {
      gridColumns.push('8px');
      flatMapping.push({ type: 'spacer' });
    }
    for (let ci = 0; ci < group.count; ci++) {
      gridColumns.push('minmax(40px, 1fr)');
      flatMapping.push({ type: 'data', colIdx: group.startIdx + ci });
    }
  }

  const gridTemplateColumns = gridColumns.join(' ');
  const totalGridCols = gridColumns.length; // includes subject label column

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Scrollable grid */}
      <div
        className="flex-1 min-h-0 overflow-auto"
        style={{ contain: 'strict' }}
      >
        <div
          role="grid"
          aria-label="BIDS coverage matrix"
          style={{
            display: 'grid',
            gridTemplateColumns,
            gap: '2px',
            padding: '4px',
            minWidth: 'min-content',
          }}
        >
          {/* ---- Session group header row (if multi-session) ---- */}
          {hasMultipleSessions && (
            <>
              {/* Corner cell for session row */}
              <div
                style={{
                  position: 'sticky',
                  left: 0,
                  top: 0,
                  zIndex: 3,
                  height: SESSION_HEADER_HEIGHT,
                  background: 'hsl(var(--background))',
                }}
              />
              {flatMapping.map((entry, i) => {
                if (entry.type === 'spacer') {
                  return (
                    <div
                      key={`sess-spacer-${i}`}
                      style={{
                        position: 'sticky',
                        top: 0,
                        zIndex: 2,
                        height: SESSION_HEADER_HEIGHT,
                        background: 'hsl(var(--background))',
                      }}
                    />
                  );
                }
                // Only render session label for the first column in each group
                const group = sessionGroups.find(
                  (g) => entry.colIdx >= g.startIdx && entry.colIdx < g.startIdx + g.count,
                );
                const isGroupStart = group && entry.colIdx === group.startIdx;
                if (!isGroupStart) {
                  return (
                    <div
                      key={`sess-empty-${i}`}
                      style={{
                        position: 'sticky',
                        top: 0,
                        zIndex: 2,
                        height: SESSION_HEADER_HEIGHT,
                        background: 'hsl(var(--background))',
                      }}
                    />
                  );
                }
                // Span across group columns — but CSS grid doesn't support colspan on children.
                // Instead, we render the label only on the first cell.
                return (
                  <div
                    key={`sess-label-${i}`}
                    className="bf-role-label text-muted-foreground"
                    style={{
                      position: 'sticky',
                      top: 0,
                      zIndex: 2,
                      height: SESSION_HEADER_HEIGHT,
                      background: 'hsl(var(--background))',
                      borderBottom: '1px solid hsl(var(--border))',
                      display: 'flex',
                      alignItems: 'center',
                      whiteSpace: 'nowrap',
                      overflow: 'visible',
                    }}
                  >
                    {group.session ? `ses-${group.session}` : 'no session'}
                  </div>
                );
              })}
            </>
          )}

          {/* ---- Column header row ---- */}
          {/* Corner cell */}
          <div
            style={{
              position: 'sticky',
              left: 0,
              top: hasMultipleSessions ? SESSION_HEADER_HEIGHT + 2 : 0,
              zIndex: 3,
              height: HEADER_HEIGHT,
              background: 'hsl(var(--background))',
            }}
          />
          {flatMapping.map((entry, i) => {
            if (entry.type === 'spacer') {
              return (
                <div
                  key={`hdr-spacer-${i}`}
                  style={{
                    position: 'sticky',
                    top: hasMultipleSessions ? SESSION_HEADER_HEIGHT + 2 : 0,
                    zIndex: 2,
                    height: HEADER_HEIGHT,
                    background: 'hsl(var(--background))',
                  }}
                />
              );
            }
            const col = coverage.columns[entry.colIdx];
            return (
              <div
                key={`hdr-${entry.colIdx}`}
                className="bf-role-section text-muted-foreground"
                style={{
                  position: 'sticky',
                  top: hasMultipleSessions ? SESSION_HEADER_HEIGHT + 2 : 0,
                  zIndex: 2,
                  height: HEADER_HEIGHT,
                  background: 'hsl(var(--background))',
                  display: 'flex',
                  alignItems: 'flex-end',
                  justifyContent: 'center',
                  paddingBottom: 4,
                  overflow: 'hidden',
                  ...(rotateHeaders
                    ? {
                        writingMode: 'vertical-rl',
                        transform: 'rotate(180deg)',
                        fontSize: 10,
                        whiteSpace: 'nowrap',
                      }
                    : {
                        textAlign: 'center',
                        whiteSpace: 'nowrap',
                        fontSize: 'var(--app-role-section-size)',
                      }),
                }}
              >
                {col.label}
              </div>
            );
          })}

          {/* ---- Data rows ---- */}
          {coverage.subjects.map((subject, rowIdx) => (
            <React.Fragment key={subject}>
              {/* Subject label — sticky left */}
              <div
                className="bf-role-mono text-foreground/80"
                style={{
                  position: 'sticky',
                  left: 0,
                  zIndex: 1,
                  background: 'hsl(var(--background))',
                  height: CELL_HEIGHT,
                  display: 'flex',
                  alignItems: 'center',
                  paddingLeft: 4,
                  paddingRight: 8,
                  fontVariantNumeric: 'tabular-nums',
                  fontSize: 'var(--app-text-xs)',
                  whiteSpace: 'nowrap',
                }}
              >
                {formatSubjectId(subject)}
              </div>
              {/* Data cells */}
              {flatMapping.map((entry, i) => {
                if (entry.type === 'spacer') {
                  return <div key={`spacer-${rowIdx}-${i}`} />;
                }
                const col = coverage.columns[entry.colIdx];
                const cell = coverage.cells[rowIdx][entry.colIdx];
                const selected = isCellSelected(subject, col, selection);
                return (
                  <DataCell
                    key={`cell-${rowIdx}-${entry.colIdx}`}
                    cell={cell}
                    col={col}
                    subject={subject}
                    selected={selected}
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                    onClick={() => selectCell(subject, col.session ?? null, col.modality)}
                  />
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Action bar for selected cell */}
      {selectedCellData && (
        <CellActionBar
          cell={selectedCellData.cell}
          col={selectedCellData.col}
          subject={selectedCellData.subject}
        />
      )}

      {/* Tooltip portal */}
      {tooltip && <CoverageTooltip data={tooltip} />}
    </div>
  );
}
