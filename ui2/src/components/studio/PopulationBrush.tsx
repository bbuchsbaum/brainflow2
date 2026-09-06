import { useEffect, useRef, useState, type ReactNode } from 'react';
import { populationProbeActions } from '@/services/studio/PopulationProbeActions';
import type { PopulationSelectionOrigin } from '@/types/population';
const control = 'rounded border border-border bg-background px-2 py-1 text-xs';
/** Uses rendered target geometry, not an assumed scale or array position. A
 * completed gesture submits stable IDs once; cancel never changes membership. */
export function PopulationBrush({
  children,
  scope,
  horizontal = false,
  lasso = false,
  origin = 'map-derived',
  selectionLabel,
}: {
  children: ReactNode;
  scope: string;
  horizontal?: boolean;
  lasso?: boolean;
  origin?: PopulationSelectionOrigin;
  selectionLabel?: string;
}) {
  const [enabled, setEnabled] = useState(false);
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
  const cancel = () => {
    start.current = null;
    setRect(null);
    path.current = [];
    setPolygon([]);
  };
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
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <button
          className={control}
          aria-pressed={enabled}
          onClick={() => {
            cancel();
            setEnabled((v) => !v);
          }}
        >
          {enabled
            ? 'Finish brushing'
            : lasso
              ? 'Lasso observations'
              : horizontal
                ? 'Brush response plot'
                : 'Brush montage'}
        </button>
        {enabled && (
          <>
            <select
              className={control}
              aria-label="Brush operation"
              value={operation}
              onChange={(e) => setOperation(e.target.value as typeof operation)}
            >
              <option value="replace">Replace</option>
              <option value="union">Add</option>
              <option value="intersection">Intersect</option>
              <option value="difference">Remove</option>
            </select>
            <span className="text-muted-foreground">
              Drag to select · release to apply · Esc cancels
            </span>
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
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
              const left = Math.min(first.x, e.clientX),
                right = Math.max(first.x, e.clientX),
                top = Math.min(first.y, e.clientY),
                bottom = Math.max(first.y, e.clientY);
              const ids = new Set<string>();
              const visible = host.current.getBoundingClientRect();
              host.current.querySelectorAll('[data-datum-id]').forEach((target) => {
                const bounds = target.getBoundingClientRect(),
                  x = bounds.x + bounds.width / 2,
                  y = bounds.y + bounds.height / 2;
                const id = target.getAttribute('data-datum-id');
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
                operation,
                origin,
                selectionLabel ??
                  (lasso
                    ? 'Spatial relationship lasso'
                    : horizontal
                      ? 'Response plot brush'
                      : 'Montage brush'),
              );
              setError(result.ok ? null : result.reason);
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
