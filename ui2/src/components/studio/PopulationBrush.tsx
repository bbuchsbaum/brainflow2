import { Button, Notice, Select } from '@/components/ui/bf';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { populationProbeActions } from '@/services/studio/PopulationProbeActions';
import type { PopulationSelectionOrigin } from '@/types/population';
/** Uses rendered target geometry, not an assumed scale or array position. A
 * completed gesture submits stable IDs once; cancel never changes membership. */
export function PopulationBrush({
  children,
  scope,
  horizontal = false,
  lasso = false,
  origin = 'map-derived',
  selectionLabel,
  status,
  active,
  onActiveChange,
  direct = false,
}: {
  children: ReactNode;
  scope: string;
  horizontal?: boolean;
  lasso?: boolean;
  origin?: PopulationSelectionOrigin;
  selectionLabel?: string;
  /** Shown at the end of the brush row, so a readout needs no row of its own. */
  status?: ReactNode;
  /**
   * Controlled brushing: the owner starts it (e.g. from a ⋯ menu) and the brush
   * shows no start button of its own; its row appears only while brushing.
   */
  active?: boolean;
  onActiveChange?: (active: boolean) => void;
  /**
   * Direct brushing (horizontal only): a drag across the plot selects what it
   * spans, with no mode to enter first. A press that does not move is a click
   * and reaches the mark under it. Shift adds, Alt removes, Esc cancels.
   */
  direct?: boolean;
}) {
  const [ownEnabled, setOwnEnabled] = useState(false);
  const controlled = active !== undefined;
  const enabled = controlled ? active : ownEnabled;
  const setEnabled = (next: boolean) =>
    controlled ? onActiveChange?.(next) : setOwnEnabled(next);
  const [operation, setOperation] = useState<'replace' | 'union' | 'intersection' | 'difference'>(
    'replace',
  );
  const [rect, setRect] = useState<{ x: number; y: number; width: number; height: number } | null>(
    null,
  );
  const path = useRef<[number, number][]>([]);
  const [polygon, setPolygon] = useState<[number, number][]>([]);
  const [error, setError] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number; scope: string } | null>(null);
  useEffect(() => {
    start.current = null;
    setRect(null);
    path.current = [];
    setPolygon([]);
  }, [scope]);
  const drag = useRef<{
    x: number;
    y: number;
    scope: string;
    pointerId: number;
    operation: typeof operation;
    moved: boolean;
  } | null>(null);
  // Direct mode: a drag that has moved. Its Escape is heard on the window
  // (the plot wrapper never holds focus), and the click its release would
  // fire is swallowed so the mark under the pointer is not also toggled.
  const [directDragging, setDirectDragging] = useState(false);
  const swallowClick = useRef(false);
  const cancel = () => {
    const was = drag.current;
    if (was?.moved) host.current?.releasePointerCapture?.(was.pointerId);
    drag.current = null;
    start.current = null;
    setRect(null);
    path.current = [];
    setPolygon([]);
    setDirectDragging(false);
  };
  useEffect(() => {
    if (!directDragging) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      // The press is still down: its release must not act as a click.
      swallowClick.current = true;
      cancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // `cancel` touches only refs and state setters.
  }, [directDragging]);
  /** Select the marks a completed gesture spans (stable IDs, submitted once). */
  const apply = (
    target: HTMLElement,
    first: { x: number; y: number },
    end: { x: number; y: number },
    vertices: [number, number][],
    op: typeof operation,
  ) => {
    const left = Math.min(first.x, end.x),
      right = Math.max(first.x, end.x),
      top = Math.min(first.y, end.y),
      bottom = Math.max(first.y, end.y);
    const ids = new Set<string>();
    const visible = target.getBoundingClientRect();
    target.querySelectorAll('[data-datum-id]').forEach((mark) => {
      const bounds = mark.getBoundingClientRect(),
        x = bounds.x + bounds.width / 2,
        y = bounds.y + bounds.height / 2;
      const id = mark.getAttribute('data-datum-id');
      if (
        id &&
        x >= visible.left &&
        x <= visible.right &&
        y >= visible.top &&
        y <= visible.bottom &&
        (lasso
          ? insidePolygon(x, y, vertices)
          : x >= left && x <= right && (horizontal || (y >= top && y <= bottom)))
      )
        ids.add(id);
    });
    const result = populationProbeActions.select(
      [...ids],
      op,
      origin,
      selectionLabel ??
        (lasso ? 'Spatial relationship lasso' : horizontal ? 'Response plot brush' : 'Montage brush'),
    );
    setError(result.ok ? null : result.reason);
  };
  if (direct) {
    return (
      <div className="min-w-0">
        {error && (
          <Notice role="alert" severity="danger">
            {error}
          </Notice>
        )}
        <div
          ref={host}
          data-testid="population-brush-direct"
          className="relative min-w-0 touch-none select-none"
          onClickCapture={(e) => {
            if (!swallowClick.current) return;
            swallowClick.current = false;
            e.preventDefault();
            e.stopPropagation();
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            swallowClick.current = false;
            drag.current = {
              x: e.clientX,
              y: e.clientY,
              scope,
              pointerId: e.pointerId,
              operation: e.shiftKey ? 'union' : e.altKey ? 'difference' : 'replace',
              moved: false,
            };
          }}
          onPointerMove={(e) => {
            const first = drag.current;
            if (!first || !host.current) return;
            // The primary button is no longer down: its release was lost
            // (outside the window, or to another handler). Nothing applies.
            if ((e.buttons & 1) === 0) {
              cancel();
              return;
            }
            if (!first.moved) {
              if (Math.abs(e.clientX - first.x) < 4) return;
              first.moved = true;
              host.current.setPointerCapture?.(first.pointerId);
              setDirectDragging(true);
            }
            const bounds = host.current.getBoundingClientRect();
            setRect({
              x: Math.min(first.x, e.clientX) - bounds.left,
              y: 0,
              width: Math.abs(first.x - e.clientX),
              height: bounds.height,
            });
          }}
          onPointerCancel={cancel}
          onPointerUp={(e) => {
            const first = drag.current;
            cancel();
            if (!first?.moved || first.scope !== scope || !host.current) return;
            // The release of a drag is not a click on the mark under it.
            swallowClick.current = true;
            apply(host.current, first, { x: e.clientX, y: e.clientY }, [], first.operation);
          }}
        >
          {children}
          {rect && (
            <div
              data-testid="population-brush-rect"
              className="pointer-events-none absolute border border-bf-border-strong bg-bf-bg-hover opacity-70"
              style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
            />
          )}
        </div>
      </div>
    );
  }
  return (
    <div
      className="min-w-0"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
          setEnabled(false);
        }
      }}
    >
      {(!controlled || enabled || error || status) && (
      <div className="mb-2 flex flex-wrap items-center gap-2 text-bf-sm">
        {(!controlled || enabled) && (
        <Button variant="secondary" size="sm"
          aria-pressed={enabled}
          onClick={() => {
            cancel();
            setEnabled(!enabled);
          }}
        >
          {enabled
            ? 'Finish brushing'
            : lasso
              ? 'Lasso observations'
              : horizontal
                ? 'Brush response plot'
                : 'Brush montage'}
        </Button>
        )}
        {enabled && (
          <>
            <Select className="w-auto max-w-full"
              aria-label="Brush operation"
              value={operation}
              onChange={(e) => setOperation(e.target.value as typeof operation)}
            >
              <option value="replace">Replace</option>
              <option value="union">Add</option>
              <option value="intersection">Intersect</option>
              <option value="difference">Remove</option>
            </Select>
            <span className="text-muted-foreground">
              Drag to select · release to apply · Esc cancels
            </span>
          </>
        )}
        {error && <Notice role="alert" severity="danger">{error}</Notice>}
        {status}
      </div>
      )}
      <div ref={host} className="relative min-w-0">
        {children}
        {enabled && (
          <div
            className="absolute inset-0 touch-none cursor-crosshair"
            tabIndex={0}
            aria-label="Population brush surface"
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.currentTarget.focus();
              e.currentTarget.setPointerCapture(e.pointerId);
              start.current = { x: e.clientX, y: e.clientY, scope };
              path.current = [[e.clientX, e.clientY]];
            }}
            onPointerMove={(e) => {
              if (!start.current || !host.current) return;
              const bounds = host.current.getBoundingClientRect(),
                first = start.current;
              if (lasso) {
                path.current.push([e.clientX, e.clientY]);
                setPolygon(path.current.map(([x, y]) => [x - bounds.left, y - bounds.top]));
                return;
              }
              setRect({
                x: Math.min(first.x, e.clientX) - bounds.left,
                y: horizontal ? 0 : Math.min(first.y, e.clientY) - bounds.top,
                width: Math.abs(first.x - e.clientX),
                height: horizontal ? bounds.height : Math.abs(first.y - e.clientY),
              });
            }}
            onPointerCancel={cancel}
            onPointerUp={(e) => {
              const first = start.current;
              const vertices = [...path.current, [e.clientX, e.clientY] as [number, number]];
              cancel();
              if (
                !first ||
                first.scope !== scope ||
                !host.current ||
                (lasso
                  ? vertices.length < 4
                  : Math.hypot(first.x - e.clientX, first.y - e.clientY) < 3)
              )
                return;
              apply(host.current, first, { x: e.clientX, y: e.clientY }, vertices, operation);
            }}
          >
            {lasso && polygon.length > 1 && (
              <svg className="pointer-events-none absolute inset-0 h-full w-full">
                <polygon
                  points={polygon.map((p) => p.join(',')).join(' ')}
                  fill="currentColor"
                  fillOpacity="0.15"
                  stroke="currentColor"
                />
              </svg>
            )}
            {rect && (
              <div
                className="pointer-events-none absolute border border-primary bg-primary/15"
                style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function insidePolygon(x: number, y: number, vertices: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const [xi, yi] = vertices[i],
      [xj, yj] = vertices[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
