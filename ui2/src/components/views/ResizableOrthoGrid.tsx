/**
 * ResizableOrthoGrid
 *
 * A CSS-grid layout for the three orthogonal slice panels (axial / sagittal /
 * coronal) with DRAGGABLE gutters that resize the panes. It restores the
 * splitter behaviour that was lost when the workspace moved from Allotment to a
 * static `gap` grid (commit 4a93761b), while keeping that refactor's two wins:
 *
 *   1. The three panels are rendered as STABLE, KEYED siblings ("axial" /
 *      "sagittal" / "coronal") in a single container, so switching arrangement
 *      only changes grid placement — React never remounts the GPU-backed panels.
 *   2. Track sizes are CSS `fr` fractions, so each panel's ResizeObserver fires
 *      on a drag and the backend re-fits the slice to its new cell size.
 *
 * Sizes are kept per-arrangement so each layout remembers its own split.
 */

import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import type { OrthoArrangement } from '@/stores/layoutSettingsStore';

/** Gutter track width (px). Wider than the visible line so it is easy to grab;
 *  the line itself is drawn ~2px in the middle via a gradient (see `gutter`). */
const GUTTER_PX = 10;
/** A pane can't be dragged below this fraction of its row/column. */
const MIN_FR = 0.12;

type SizeKey = 'row' | 'column' | 'gridCols' | 'gridRows';

interface OrthoSizes {
  row: number[]; // 3 column fractions (row arrangement)
  column: number[]; // 3 row fractions (column arrangement)
  gridCols: number[]; // 2 column fractions (grid: sagittal | coronal)
  gridRows: number[]; // 2 row fractions (grid: axial / bottom row)
}

const INITIAL_SIZES: OrthoSizes = {
  row: [1, 1, 1],
  column: [1, 1, 1],
  gridCols: [1, 1],
  gridRows: [1, 1],
};

export interface ResizableOrthoGridProps {
  arrangement: OrthoArrangement;
  axial: ReactNode;
  sagittal: ReactNode;
  coronal: ReactNode;
}

export function ResizableOrthoGrid({
  arrangement,
  axial,
  sagittal,
  coronal,
}: ResizableOrthoGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState<OrthoSizes>(INITIAL_SIZES);

  // Begin dragging the gutter between track `index` and `index + 1` of the
  // `key` dimension. `axis` is the pointer axis that drives the resize. Uses
  // mouse events to match the rest of the slice UI (SliceViewport / useWindowLevel)
  // — synthetic/automation input and this WKWebView emit mouse, not pointer, events.
  const startDrag = useCallback(
    (key: SizeKey, index: number, axis: 'x' | 'y') => (e: ReactMouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();

      // Snapshot the starting fractions for this dimension.
      const startArr = (
        key === 'row'
          ? sizes.row
          : key === 'column'
            ? sizes.column
            : key === 'gridCols'
              ? sizes.gridCols
              : sizes.gridRows
      ).slice();
      const sumFr = startArr.reduce((a, b) => a + b, 0);
      const gutters = startArr.length - 1;
      const contentPx = (axis === 'x' ? rect.width : rect.height) - gutters * GUTTER_PX;
      if (contentPx <= 0 || sumFr <= 0) return;
      const pxPerFr = contentPx / sumFr;
      const start = axis === 'x' ? e.clientX : e.clientY;
      const a0 = startArr[index];
      const b0 = startArr[index + 1];
      const pairSum = a0 + b0;

      const onMove = (ev: MouseEvent) => {
        const deltaPx = (axis === 'x' ? ev.clientX : ev.clientY) - start;
        const deltaFr = deltaPx / pxPerFr;
        let a = a0 + deltaFr;
        // Clamp both panes of the pair to the minimum fraction.
        a = Math.max(MIN_FR, Math.min(pairSum - MIN_FR, a));
        const b = pairSum - a;
        const next = startArr.slice();
        next[index] = a;
        next[index + 1] = b;
        setSizes((prev) => ({ ...prev, [key]: next }));
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove, true);
        window.removeEventListener('mouseup', onUp, true);
      };
      // Capture phase: the slice views call stopPropagation on their mouse
      // handlers, so a bubble-phase window listener would be starved once the
      // cursor moves over a pane mid-drag. Capturing fires before they can stop it.
      window.addEventListener('mousemove', onMove, true);
      window.addEventListener('mouseup', onUp, true);
    },
    [sizes],
  );

  const gutter = (
    keyId: string,
    axis: 'x' | 'y',
    placement: CSSProperties,
    onDown: (e: ReactMouseEvent<HTMLDivElement>) => void,
  ): ReactNode => (
    <div
      key={keyId}
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      data-testid={`ortho-gutter-${keyId}`}
      onMouseDown={onDown}
      className="ortho-gutter"
      style={{
        ...placement,
        cursor: axis === 'x' ? 'col-resize' : 'row-resize',
        // Thin (~2px) visible line centered in the wider grabbable strip.
        background: `linear-gradient(${
          axis === 'x' ? 'to right' : 'to bottom'
        }, transparent 0 4px, var(--app-splitter, var(--app-border-subtle)) 4px 6px, transparent 6px)`,
        touchAction: 'none',
        zIndex: 5,
      }}
    />
  );

  // The three panels are ALWAYS rendered with these stable keys, so React keeps
  // their instances across arrangement changes regardless of sibling order.
  let gridStyle: CSSProperties;
  let children: ReactNode[];

  if (arrangement === 'row') {
    const [c0, c1, c2] = sizes.row;
    gridStyle = {
      display: 'grid',
      width: '100%',
      height: '100%',
      gridTemplateRows: 'minmax(0, 1fr)',
      // minmax(0, …) lets tracks shrink below the slice canvas's min-content
      // size — a plain `Nfr` is `minmax(auto, Nfr)` and won't resize past it.
      gridTemplateColumns: `minmax(0, ${c0}fr) ${GUTTER_PX}px minmax(0, ${c1}fr) ${GUTTER_PX}px minmax(0, ${c2}fr)`,
    };
    children = [
      <div key="axial" style={{ gridColumn: 1, position: 'relative', minWidth: 0 }}>
        {axial}
      </div>,
      gutter('row-0', 'x', { gridColumn: 2, gridRow: 1 }, startDrag('row', 0, 'x')),
      <div key="sagittal" style={{ gridColumn: 3, position: 'relative', minWidth: 0 }}>
        {sagittal}
      </div>,
      gutter('row-1', 'x', { gridColumn: 4, gridRow: 1 }, startDrag('row', 1, 'x')),
      <div key="coronal" style={{ gridColumn: 5, position: 'relative', minWidth: 0 }}>
        {coronal}
      </div>,
    ];
  } else if (arrangement === 'column') {
    const [r0, r1, r2] = sizes.column;
    gridStyle = {
      display: 'grid',
      width: '100%',
      height: '100%',
      gridTemplateColumns: 'minmax(0, 1fr)',
      gridTemplateRows: `minmax(0, ${r0}fr) ${GUTTER_PX}px minmax(0, ${r1}fr) ${GUTTER_PX}px minmax(0, ${r2}fr)`,
    };
    children = [
      <div key="axial" style={{ gridRow: 1, position: 'relative', minHeight: 0 }}>
        {axial}
      </div>,
      gutter('col-0', 'y', { gridRow: 2, gridColumn: 1 }, startDrag('column', 0, 'y')),
      <div key="sagittal" style={{ gridRow: 3, position: 'relative', minHeight: 0 }}>
        {sagittal}
      </div>,
      gutter('col-1', 'y', { gridRow: 4, gridColumn: 1 }, startDrag('column', 1, 'y')),
      <div key="coronal" style={{ gridRow: 5, position: 'relative', minHeight: 0 }}>
        {coronal}
      </div>,
    ];
  } else {
    // grid: axial spans the top row full-width; sagittal | coronal below.
    const [cl, cr] = sizes.gridCols;
    const [rt, rb] = sizes.gridRows;
    gridStyle = {
      display: 'grid',
      width: '100%',
      height: '100%',
      gridTemplateColumns: `minmax(0, ${cl}fr) ${GUTTER_PX}px minmax(0, ${cr}fr)`,
      gridTemplateRows: `minmax(0, ${rt}fr) ${GUTTER_PX}px minmax(0, ${rb}fr)`,
    };
    children = [
      <div
        key="axial"
        style={{ gridRow: 1, gridColumn: '1 / 4', position: 'relative', minWidth: 0, minHeight: 0 }}
      >
        {axial}
      </div>,
      gutter('grid-row', 'y', { gridRow: 2, gridColumn: '1 / 4' }, startDrag('gridRows', 0, 'y')),
      <div key="sagittal" style={{ gridRow: 3, gridColumn: 1, position: 'relative', minWidth: 0 }}>
        {sagittal}
      </div>,
      gutter('grid-col', 'x', { gridRow: 3, gridColumn: 2 }, startDrag('gridCols', 0, 'x')),
      <div key="coronal" style={{ gridRow: 3, gridColumn: 3, position: 'relative', minWidth: 0 }}>
        {coronal}
      </div>,
    ];
  }

  return (
    <div ref={containerRef} style={gridStyle}>
      {children}
    </div>
  );
}

export default ResizableOrthoGrid;
