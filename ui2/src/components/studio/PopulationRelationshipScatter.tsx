import { studioWorkspaceKey } from '@/hooks/useStudioWorkspace';
/**
 * The relationship scatter (classical MDS at fitted positions) with its hover
 * peek and keyboard navigation (W1 UI).
 *
 * - Hover previews, click focuses. After `PEEK_HOVER_DELAY_MS` over a point a
 *   floating peek shows that observation's slice; hover never changes focus
 *   or the Inspector. Moving away dismisses an unpinned peek.
 * - One tab stop: arrow keys move between points (nearest ahead in that
 *   direction) and show the peek at once; Enter focuses, Shift+Enter adds or
 *   removes the point from the selection, Escape closes the peek.
 * - Focus, selection and preview differ in form: the focused observation has
 *   a round amber ring, selected points a light fill, and the previewed or
 *   keyboard-current point a dashed neutral square.
 * - The focused observation's true nearest neighbours (by declared distance,
 *   not by the plot) are joined to it with lines and numbered.
 *
 * Only point marks are `<circle>` elements carrying `data-datum-id`, so the
 * lasso and harness checks see exactly the fitted points.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import { populationProbeActions } from '@/services/studio/PopulationProbeActions';
import {
  PopulationPeekService,
  directionalNeighbour,
  type ScatterDirection,
} from '@/services/studio/PopulationPeekService';
import {
  populationRevisionKey,
  type PopulationSliceDisplay,
  type PopulationSliceService,
} from '@/services/studio/PopulationSliceService';
import { useViewStateStore } from '@/stores/viewStateStore';
import { PopulationScatterPeek } from './PopulationScatterPeek';
import {
  PEEK_DISMISS_DELAY_MS,
  PEEK_HOVER_DELAY_MS,
  placePeek,
  peekStepPlane,
  steppedPeekView,
  type PopulationPeekView,
} from './relationshipPresentation';


const VIEW_W = 560,
  VIEW_H = 300,
  CX = 280,
  CY = 145,
  SCALE = 115;
const ARROWS: Record<string, ScatterDirection> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

const PLANE_KEYS: Record<string, PopulationPeekView['orientation']> = {
  a: 'axial',
  c: 'coronal',
  s: 'sagittal',
};
const noSubscription = () => () => {};
const noSnapshot = () => null;

interface PeekState {
  memberId: string;
  pinned: boolean;
}


function peekScope(displayed: PopulationSliceDisplay | null | undefined): string | null {
  return displayed
    ? JSON.stringify([
        displayed.query.datasetKey,
        populationRevisionKey(displayed.data.sources, displayed.data.maskRevision),
        displayed.query.request.dimPx,
        displayed.query.request.zoom,
      ])
    : null;
}

export function PopulationRelationshipScatter({
  fitId,
  fitted,
  coordinates,
  selected,
  activeMemberId,
  neighbourMarks,
  sliceService,
  bounds,
  onToggle,
}: {
  fitId: string;
  fitted: readonly string[];
  coordinates: readonly (readonly [number, number])[];
  selected: ReadonlySet<string>;
  activeMemberId: string | null;
  /** The focused observation's true nearest neighbours to draw (empty when stale). */
  neighbourMarks: readonly { memberId: string; rank: number }[];
  sliceService?: PopulationSliceService;
  /** The element the peek is placed in and kept inside (the relationship section). */
  bounds: HTMLElement | null;
  onToggle: (memberId: string) => void;
}) {
  const instructions = useId();
  const limit = Math.max(0, ...coordinates.flat().map(Math.abs)) || 1;
  const points = useMemo(
    () =>
      coordinates.map(
        ([x, y]) => [CX + (x / limit) * SCALE, CY - (y / limit) * SCALE] as [number, number],
      ),
    [coordinates, limit],
  );
  const index = useMemo(() => new Map(fitted.map((id, i) => [id, i])), [fitted]);

  const [cursor, setCursor] = useState<string | null>(null);
  const [hasFocus, setHasFocus] = useState(false);
  const cursorId =
    cursor !== null && index.has(cursor)
      ? cursor
      : activeMemberId !== null && index.has(activeMemberId)
        ? activeMemberId
        : (fitted[0] ?? null);
  const nodes = useRef(new Map<string, SVGCircleElement>());
  const svg = useRef<SVGSVGElement>(null);
  const peekHost = useRef<HTMLDivElement | null>(null);
  // WKWebView buttons take no focus on click, so a click inside the peek can
  // blur the point with no related target; the pointer position says where it went.
  const pointerInPeek = useRef(false);
  const peekId = useId();

  // Peek state and data.
  const [peek, setPeek] = useState<PeekState | null>(null);
  const [peekView, setPeekView] = useState<PopulationPeekView | null>(null);
  const [service] = useState(() => new PopulationPeekService());
  const snapshot = useSyncExternalStore(service.subscribe, service.getSnapshot);
  const slice = useSyncExternalStore(
    sliceService?.subscribe ?? noSubscription,
    sliceService?.getSnapshot ?? noSnapshot,
  );
  const displayed = slice?.displayed ?? null;
  const scope = peekScope(displayed);
  // A raster read from other source revisions than the lens shows is dropped
  // with a message rather than shown under the lens's colour range.
  const displayedRef = useRef(displayed);
  useEffect(() => {
    displayedRef.current = displayed;
  }, [displayed]);
  useEffect(() => {
    service.setEvaluator(
      sliceService
        ? async (target, signal) => {
            const raster = await sliceService.evaluatePeek(target, signal);
            const shown = displayedRef.current;
            if (
              shown &&
              raster.revisionKey !==
                populationRevisionKey(shown.data.sources, shown.data.maskRevision)
            )
              throw new Error('The sources changed since the lens read them; preview dropped.');
            return raster;
          }
        : null,
    );
  }, [service, sliceService]);
  useEffect(() => service.setScope(scope), [service, scope]);
  useEffect(() => {
    service.request(peek && peekView ? { memberId: peek.memberId, ...peekView } : null);
  }, [service, peek, peekView]);
  useEffect(() => () => service.dispose(), [service]);

  const timers = useRef<{
    open: ReturnType<typeof setTimeout> | null;
    close: ReturnType<typeof setTimeout> | null;
  }>({ open: null, close: null });
  const clearTimer = (which: 'open' | 'close') => {
    const timer = timers.current[which];
    if (timer !== null) clearTimeout(timer);
    timers.current[which] = null;
  };
  useEffect(
    () => () => {
      clearTimer('open');
      clearTimer('close');
    },
    [],
  );
  // A new fit is a new picture: an open peek belongs to the old one.
  useEffect(() => {
    clearTimer('open');
    clearTimer('close');
    setPeek(null);
  }, [fitId]);

  const defaultView = useCallback((): PopulationPeekView => {
    if (displayed)
      return {
        crosshairMm: [...displayed.query.request.crosshairMm],
        orientation: displayed.query.request.orientation,
      };
    return {
      crosshairMm: [
        ...useViewStateStore.getState().getWorkspaceViewState(studioWorkspaceKey()).crosshair.world_mm,
      ] as [
        number,
        number,
        number,
      ],
      orientation: 'axial',
    };
  }, [displayed]);

  // Timers read the latest peek, not the one captured when they were set.
  const peekRef = useRef<PeekState | null>(null);
  peekRef.current = peek;
  const openPeek = (memberId: string) => {
    clearTimer('close');
    const current = peekRef.current;
    if (current?.memberId === memberId) return;
    // An open peek keeps its slice while it moves between points.
    if (!current) setPeekView(defaultView());
    const next = { memberId, pinned: current?.pinned ?? false };
    peekRef.current = next;
    setPeek(next);
  };
  const closePeek = () => {
    pointerInPeek.current = false;
    clearTimer('open');
    clearTimer('close');
    setPeek(null);
  };
  const scheduleClose = () => {
    clearTimer('close');
    timers.current.close = setTimeout(() => {
      timers.current.close = null;
      setPeek((current) => (current?.pinned ? current : null));
    }, PEEK_DISMISS_DELAY_MS);
  };

  const onPointEnter = (memberId: string) => {
    clearTimer('close');
    if (peek?.pinned) return;
    clearTimer('open');
    timers.current.open = setTimeout(() => {
      timers.current.open = null;
      openPeek(memberId);
    }, PEEK_HOVER_DELAY_MS);
  };
  const onPointLeave = () => {
    clearTimer('open');
    if (peek && !peek.pinned) scheduleClose();
  };

  const moveCursor = (memberId: string) => {
    setCursor(memberId);
    nodes.current.get(memberId)?.focus();
    openPeek(memberId);
  };
  const onKeyDown = (event: React.KeyboardEvent<SVGCircleElement>, memberId: string) => {
    const direction = ARROWS[event.key];
    if (direction) {
      event.preventDefault();
      event.stopPropagation();
      const from = index.get(memberId);
      const next = from === undefined ? null : directionalNeighbour(points, from, direction);
      if (next !== null) moveCursor(fitted[next]);
      else openPeek(memberId);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (event.shiftKey) onToggle(memberId);
      else populationProbeActions.focus(memberId);
    } else if (event.key === 'Escape' && peek) {
      event.preventDefault();
      event.stopPropagation();
      closePeek();
    } else if (!event.ctrlKey && !event.metaKey && !event.altKey) {
      const key = event.key.toLowerCase();
      const plane = PLANE_KEYS[key];
      if (key === 'p') {
        event.preventDefault();
        if (!peekRef.current) openPeek(memberId);
        const pinned = !(peekRef.current?.pinned ?? false);
        peekRef.current = peekRef.current ? { ...peekRef.current, pinned } : null;
        setPeek(peekRef.current);
      } else if (plane) {
        event.preventDefault();
        if (!peekRef.current) openPeek(memberId);
        setPeekView((view) => (view ? { ...view, orientation: plane } : view));
      } else if ((event.key === 'PageUp' || event.key === 'PageDown') && peekRef.current) {
        event.preventDefault();
        stepPeek(event.key === 'PageUp' ? 1 : -1);
      }
    }
  };

  const stepPeek = (direction: number) =>
    setPeekView((view) =>
      view
        ? steppedPeekView(view, direction, peekStepPlane(service.getSnapshot().raster, view))
        : view,
    );

  // Place the peek beside its point, inside the bounds element.
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    if (!peek || !bounds) return;
    const node = nodes.current.get(peek.memberId);
    if (!node) return;
    const outer = bounds.getBoundingClientRect(),
      mark = node.getBoundingClientRect();
    const next = placePeek(
      { x: mark.left + mark.width / 2 - outer.left, y: mark.top + mark.height / 2 - outer.top },
      { width: bounds.clientWidth, height: bounds.clientHeight },
    );
    setPosition((previous) =>
      previous.left === next.left && previous.top === next.top ? previous : next,
    );
  }, [peek, bounds]);

  const focused = activeMemberId !== null ? index.get(activeMemberId) : undefined;
  const previewId = peek?.memberId ?? (hasFocus ? cursorId : null);
  const preview = previewId !== null ? index.get(previewId) : undefined;
  const marks = neighbourMarks
    .map((m) => ({ ...m, at: index.get(m.memberId) }))
    .filter((m): m is { memberId: string; rank: number; at: number } => m.at !== undefined);

  const peekNode =
    peek && peekView && index.has(peek.memberId) ? (
      <div
        ref={peekHost}
        onPointerDownCapture={() => {
          pointerInPeek.current = true;
        }}
      >
        <PopulationScatterPeek
          id={peekId}
          memberId={peek.memberId}
          view={peekView}
          snapshot={snapshot}
          effectLimit={displayed?.effectLimit ?? 1}
          pinned={peek.pinned}
          position={position}
          onViewChange={setPeekView}
          onPinnedChange={(pinned) =>
            setPeek((current) => (current ? { ...current, pinned } : current))
          }
          onClose={() => {
            closePeek();
            if (peek && nodes.current.has(peek.memberId)) nodes.current.get(peek.memberId)?.focus();
          }}
          onPointerEnter={() => {
            pointerInPeek.current = true;
            clearTimer('close');
          }}
          onPointerLeave={() => {
            pointerInPeek.current = false;
            if (!peek.pinned) scheduleClose();
          }}
        />
      </div>
    ) : null;

  return (
    <>
      <svg
        ref={svg}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="block max-h-[360px] w-full"
        role="group"
        aria-label="Spatial MDS observations"
        aria-describedby={instructions}
        onFocus={() => setHasFocus(true)}
        onBlur={(event) => {
          const next = event.relatedTarget as Node | null;
          if (next && svg.current?.contains(next)) return;
          setHasFocus(false);
          if (
            peek &&
            !peek.pinned &&
            !pointerInPeek.current &&
            !(next && peekHost.current?.contains(next))
          )
            closePeek();
        }}
      >
        <line x1={CX} x2={CX} y1="20" y2="270" stroke="var(--bf-plot-grid)" />
        <line x1="25" x2="535" y1={CY} y2={CY} stroke="var(--bf-plot-grid)" />
        <text
          x="12"
          y={CY}
          transform={`rotate(-90 12 ${CY})`}
          textAnchor="middle"
          fill="var(--bf-text-muted)"
          fontSize="11"
        >
          MDS axis 2
        </text>
        <text x={CX} y="294" textAnchor="middle" fill="var(--bf-text-muted)" fontSize="11">
          MDS axis 1
        </text>
        {focused !== undefined &&
          marks.map((m) => (
            <line
              key={`line-${m.memberId}`}
              data-neighbour-line={m.memberId}
              x1={points[focused][0]}
              y1={points[focused][1]}
              x2={points[m.at][0]}
              y2={points[m.at][1]}
              stroke="var(--bf-border-strong)"
              strokeWidth="1"
              pointerEvents="none"
            />
          ))}
        {fitted.map((memberId, i) => {
          const isFocused = memberId === activeMemberId,
            isSelected = selected.has(memberId);
          return (
            <circle
              key={memberId}
              ref={(el) => {
                if (el) nodes.current.set(memberId, el);
                else nodes.current.delete(memberId);
              }}
              data-datum-id={memberId}
              data-fit-x={coordinates[i][0]}
              data-fit-y={coordinates[i][1]}
              data-focused={isFocused || undefined}
              cx={points[i][0]}
              cy={points[i][1]}
              r={isFocused ? 6 : 4}
              fill={isSelected ? 'var(--bf-text-primary)' : 'var(--bf-text-muted)'}
              className="cursor-pointer outline-none"
              role="button"
              tabIndex={memberId === cursorId ? 0 : -1}
              aria-label={`Focus relationship ${memberId}`}
              aria-pressed={isSelected}
              aria-current={isFocused ? 'true' : undefined}
              aria-describedby={peek?.memberId === memberId ? peekId : undefined}
              onPointerEnter={() => onPointEnter(memberId)}
              onPointerLeave={onPointLeave}
              onFocus={() => setCursor(memberId)}
              onClick={(event) => {
                setCursor(memberId);
                if (event.shiftKey) onToggle(memberId);
                else populationProbeActions.focus(memberId);
              }}
              onKeyDown={(event) => onKeyDown(event, memberId)}
            >
              <title>{memberId} · hover to preview · click to focus · Shift-click to select</title>
            </circle>
          );
        })}
        {focused !== undefined && (
          <ellipse
            aria-hidden
            data-mark="focus"
            cx={points[focused][0]}
            cy={points[focused][1]}
            rx="10"
            ry="10"
            fill="none"
            stroke="var(--bf-border-focus)"
            strokeWidth="2"
            pointerEvents="none"
          />
        )}
        {preview !== undefined && (
          <rect
            aria-hidden
            data-mark="preview"
            x={points[preview][0] - 13}
            y={points[preview][1] - 13}
            width="26"
            height="26"
            fill="none"
            stroke="var(--bf-text-primary)"
            strokeWidth="1"
            strokeDasharray="3 2"
            pointerEvents="none"
          />
        )}
        {focused !== undefined && (
          <text
            aria-hidden
            x={points[focused][0] - 12}
            y={points[focused][1] - 13}
            textAnchor="end"
            fontSize="10"
            fill="var(--bf-text-primary)"
            className="font-mono"
            pointerEvents="none"
          >
            {fitted[focused]}
          </text>
        )}
        {marks.map((m) => (
          <text
            key={`rank-${m.memberId}`}
            aria-hidden
            data-neighbour-rank={m.rank}
            x={points[m.at][0] + 7}
            y={points[m.at][1] - 6}
            fontSize="10"
            fill="var(--bf-text-secondary)"
            className="font-mono"
            pointerEvents="none"
          >
            {m.rank}
          </text>
        ))}
      </svg>
      <p id={instructions} className="sr-only">
        Arrow keys move between observations and preview each one. Enter focuses, Shift+Enter adds
        or removes it from the selection, Escape closes the preview. P pins the preview; A, C and S
        switch its plane to axial, coronal or sagittal; Page Up and Page Down step its slice.
      </p>
      {peekNode && (bounds ? createPortal(peekNode, bounds) : peekNode)}
    </>
  );
}
