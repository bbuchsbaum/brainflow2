import { studioWorkspaceKey } from '@/hooks/useStudioWorkspace';
/**
 * The relationship scatter (classical MDS at fitted positions) with its hover
 * peek and keyboard navigation (W1 UI).
 *
 * - Hover previews, click focuses. After `PEEK_HOVER_DELAY_MS` over a point a
 *   floating peek shows that observation's slice; hover never changes focus
 *   or the Inspector. Moving away dismisses an unpinned peek.
 * - One tab stop: arrow keys move between points (nearest ahead in that
 *   direction) and show the peek at once; Enter focuses, Shift+Enter (or
 *   ⌘/Ctrl+Enter, see `isAdditive`) adds or removes the point from the
 *   selection, Escape closes the peek. Shift- or ⌘-click (Ctrl off a Mac)
 *   does the same for a pointer.
 * - One code per channel: group is the mark's shape (`groupMarks`); selection
 *   is contrast (with a selection made, unselected points fall to 40 %
 *   opacity, selected ones stay full); focus is a round ring; the previewed or
 *   keyboard-current point a dashed neutral square. Every point wears one ink.
 * - The focused observation's true nearest neighbours (by declared distance,
 *   not by the plot) are joined to it with faint spokes, numbered as the
 *   Inspector's Nearest list numbers them. With `spokes="engaged"` they show
 *   only while the pointer or keyboard is on the map, or the focused subject
 *   is pointed at elsewhere (its tile).
 * - No axes: classical MDS axes have no units. One scale on both axes.
 * - Robust extent (`robustProjection`, `extent`): only points beyond 3 robust
 *   SDs of the median on an axis fall outside the frame ('core'); 'groups'
 *   never clamps half or more of a group; 'all' clamps nothing. Each
 *   off-scale point is one small muted tick at the edge where it lies; one
 *   "N off-scale" note lists their short IDs (true positions in its tooltip),
 *   and names any group mostly off-scale ("G2 · 6 · 4 off-scale") in place of
 *   its centroid label. Each point keeps its name, tooltip and description.
 * - Labels never overprint (`placeScatterLabels`): the focused point's ID
 *   wins, then each group's name and size at the centroid of its members in
 *   the frame (a hairline leader when it sits apart), then short IDs of the
 *   five most extreme points in the frame where room remains, then the
 *   neighbour numerals. Outliers keep the hollow diamond.
 * - Direct lasso (when `onLasso` is given): drag on empty space draws it;
 *   Shift- or ⌘-drag (Ctrl off a Mac) adds; Escape cancels a lasso or clears
 *   the selection.
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
import { MARK_UNSELECTED_OPACITY } from './subsetOpacity';
import { additiveKeyLabel, isAdditive } from '@/utils/selectionModifier';
import { groupMarkParts, type GroupMarkKind } from './groupMarks';
import {
  extremePoints,
  offScaleGroups,
  placeScatterLabels,
  robustProjection,
  shortIdPrefix,
  type LabelBox,
  type ScatterExtent,
  type ScatterFrame,
} from './similarityStripLayout';
import {
  NORMAL_AXIS,
  PEEK_DISMISS_DELAY_MS,
  PEEK_HOVER_DELAY_MS,
  PEEK_PREFETCH_STEPS,
  placePeek,
  peekStepPlane,
  steppedPeekView,
  type PopulationPeekView,
} from './relationshipPresentation';


/** The wide panel's frame: one scale on both axes, centred. */
const WIDE: ScatterFrame = { w: 560, h: 300, margin: 14 };
/** The strip's square frame: one scale on both axes, the same room each way. */
const SQUARE: ScatterFrame = { w: 300, h: 300, margin: 12 };
/** A point's mark radius, and its (larger, invisible) hit target. */
const MARK_R = 3.25;
const HIT_R = 5.5;
const FOCUS_RING_R = 8;
/** Unselected points while a selection exists (the subset rule, `subsetOpacity.ts`). */
const UNSELECTED_OPACITY = MARK_UNSELECTED_OPACITY;
/** One ink for every point: selection is told by contrast, not by a second colour. */
const INK = 'var(--bf-text-secondary)';
/** An off-scale point's edge tick: its length, from the frame's inner edge outward. */
const TICK_LEN = 6;
/** How many of the most extreme points carry a short label. */
const EXTREME_LABELS = 5;
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
  square = false,
  marks,
  groupLabels,
  linkedId = null,
  onHoverMember,
  onLasso,
  onClear,
  spokes: spokesShown = 'always',
  extent = 'groups',
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
  /** Drawn in a square frame (the similarity strip). Both frames use one scale on both axes. */
  square?: boolean;
  /** Each point's group mark (`groupMarks`); a plain dot when absent. */
  marks?: ReadonlyMap<string, GroupMarkKind>;
  /** Direct labels at each group's centroid ("G1 · 29"); outliers have none. */
  groupLabels?: readonly { id: string; text: string; memberIds: readonly string[] }[];
  /** A subject pointed at in the grid: its point is ringed. */
  linkedId?: string | null;
  /** The point under the pointer, or null when it leaves (outlines its tile). */
  onHoverMember?: (memberId: string | null) => void;
  /**
   * Direct lasso: a drag on empty space draws it and, on release, hands over
   * the points inside it ('union' when Shift was held at the start).
   */
  onLasso?: (memberIds: string[], mode: 'replace' | 'union') => void;
  /** Escape with no lasso in progress and a selection made: clear it. */
  onClear?: () => void;
  /**
   * When the neighbour spokes and numerals show: 'always' while a subject is
   * focused, or 'engaged': only while the pointer or keyboard is on the map
   * (or the focused subject is pointed at elsewhere).
   */
  spokes?: 'always' | 'engaged';
  /**
   * How the frame is fitted (`ScatterExtent`): 'core' frames the robust core
   * and sends the rest, whole groups included, to the off-scale note; 'all'
   * frames every point; 'groups' (default) widens the core for any group
   * that would lose half its members.
   */
  extent?: ScatterExtent;
}) {
  const instructions = useId();
  const frame = square ? SQUARE : WIDE;
  const { w: VIEW_W, h: VIEW_H } = frame;
  const index = useMemo(() => new Map(fitted.map((id, i) => [id, i])), [fitted]);
  const groupIndices = useMemo(
    () =>
      (groupLabels ?? []).map((label) =>
        label.memberIds.map((id) => index.get(id)).filter((i): i is number => i !== undefined),
      ),
    [groupLabels, index],
  );
  const projection = useMemo(
    () => robustProjection(coordinates, frame, groupIndices, extent),
    [coordinates, frame, groupIndices, extent],
  );
  const points = useMemo(
    () => projection.points.map((p) => [p.x, p.y] as [number, number]),
    [projection],
  );
  const offScale = useMemo(
    () => projection.points.flatMap((p, i) => (p.out ? [i] : [])),
    [projection],
  );
  // A group mostly off-scale is named in the note, not at a centroid of its few
  // members left in the frame ("G2 · 6 · 4 off-scale").
  const groupsOff = useMemo(
    () =>
      offScaleGroups(
        (groupLabels ?? []).map((label, g) => ({ ...label, members: groupIndices[g] ?? [] })),
        projection.points,
      ),
    [groupLabels, groupIndices, projection],
  );

  const [cursor, setCursor] = useState<string | null>(null);
  const [hasFocus, setHasFocus] = useState(false);
  // The pointer or keyboard on the map: engaged spokes show only then.
  const [pointerOn, setPointerOn] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
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
  // Once the user steps the peek's slice, read the next slices in the
  // direction of travel while idle, so further steps are served from cache.
  // Hovering across points prefetches nothing: that would cost native reads
  // for slices nobody asked for and hold up the next point's preview.
  const travel = useRef<{ memberId: string; direction: number } | null>(null);
  const previousView = useRef<{ memberId: string; view: PopulationPeekView } | null>(null);
  useEffect(() => {
    const before = previousView.current;
    previousView.current = peek && peekView ? { memberId: peek.memberId, view: peekView } : null;
    if (!peek || !peekView) {
      travel.current = null;
      return;
    }
    if (travel.current?.memberId !== peek.memberId) travel.current = null;
    if (
      before?.memberId !== peek.memberId ||
      before.view.orientation !== peekView.orientation
    )
      return;
    const axis = NORMAL_AXIS[peekView.orientation].index;
    const moved = peekView.crosshairMm[axis] - before.view.crosshairMm[axis];
    if (moved) travel.current = { memberId: peek.memberId, direction: Math.sign(moved) };
  }, [peek, peekView]);
  const settledRaster = !snapshot.pending ? snapshot.raster : null;
  useEffect(() => {
    const direction = travel.current?.direction;
    if (!peek || !peekView || !direction || !settledRaster || settledRaster.memberId !== peek.memberId)
      return;
    const plane = peekStepPlane(settledRaster, peekView);
    if (!plane) return;
    const ahead: PopulationPeekView[] = [];
    let view = peekView;
    for (let i = 0; i < PEEK_PREFETCH_STEPS; i++) {
      view = steppedPeekView(view, direction, plane);
      ahead.push(view);
    }
    service.prefetch(ahead.map((v) => ({ memberId: peek.memberId, ...v })));
  }, [service, peek, peekView, settledRaster]);
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
    onHoverMember?.(memberId);
    clearTimer('close');
    if (peek?.pinned) return;
    clearTimer('open');
    timers.current.open = setTimeout(() => {
      timers.current.open = null;
      openPeek(memberId);
    }, PEEK_HOVER_DELAY_MS);
  };
  const onPointLeave = () => {
    onHoverMember?.(null);
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
      if (isAdditive(event)) onToggle(memberId);
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
  const engaged =
    spokesShown === 'always' ||
    pointerOn ||
    focusWithin ||
    (linkedId !== null && linkedId === activeMemberId);
  const spokes = useMemo(
    () =>
      focused === undefined || !engaged
        ? []
        : neighbourMarks
            .map((m) => ({ ...m, at: index.get(m.memberId) }))
            .filter((m): m is { memberId: string; rank: number; at: number } => m.at !== undefined),
    [neighbourMarks, index, focused, engaged],
  );
  const prefix = useMemo(() => shortIdPrefix(fitted), [fitted]);
  const layout = useMemo(() => {
    const obstacles: LabelBox[] = [];
    if (focused !== undefined) {
      const [fx, fy] = points[focused];
      obstacles.push({
        x0: fx - FOCUS_RING_R - 1,
        y0: fy - FOCUS_RING_R - 1,
        x1: fx + FOCUS_RING_R + 1,
        y1: fy + FOCUS_RING_R + 1,
      });
    }
    return placeScatterLabels({
      frame,
      points,
      focus: focused !== undefined ? { id: fitted[focused], text: fitted[focused], index: focused } : null,
      // Each group is named at the centroid of its members in the frame.
      groups: (groupLabels ?? []).flatMap((label, g) => {
        if (groupsOff.some((entry) => entry.group.id === label.id)) return [];
        const members = groupIndices[g] ?? [];
        const inFrame = members.filter((i) => !projection.points[i].out);
        return members.length
          ? [{ id: label.id, text: label.text, members: inFrame.length ? inFrame : members }]
          : [];
      }),
      // Off-scale points carry no ID on the map: the off-scale note lists them.
      extremes: extremePoints(coordinates, EXTREME_LABELS + offScale.length)
        .filter((i) => !projection.points[i].out)
        .slice(0, EXTREME_LABELS)
        .map((i) => ({
          id: fitted[i],
          text: fitted[i].slice(prefix.length),
          index: i,
        })),
      ranks: spokes.map((m) => ({ id: m.memberId, text: String(m.rank), index: m.at })),
      obstacles,
      focusOffset: FOCUS_RING_R + 3,
    });
  }, [
    spokes,
    focused,
    points,
    frame,
    fitted,
    groupLabels,
    groupIndices,
    groupsOff,
    projection,
    offScale,
    coordinates,
    prefix,
  ]);
  const rankAt = useMemo(() => new Map(layout.ranks.map((label) => [label.id, label])), [layout]);
  const hasSelection = selected.size > 0;

  // Direct lasso, in the frame's own (viewBox) units.
  const [lasso, setLasso] = useState<[number, number][] | null>(null);
  const lassoRef = useRef<{ path: [number, number][]; mode: 'replace' | 'union' } | null>(null);
  const toFrame = (clientX: number, clientY: number): [number, number] => {
    const box = svg.current?.getBoundingClientRect();
    if (!box || !box.width || !box.height) return [clientX, clientY];
    // The default preserveAspectRatio (xMidYMid meet): one scale, centred.
    const k = Math.min(box.width / VIEW_W, box.height / VIEW_H);
    const left = box.left + (box.width - VIEW_W * k) / 2,
      top = box.top + (box.height - VIEW_H * k) / 2;
    return [(clientX - left) / k, (clientY - top) / k];
  };
  // The drawn path follows the pointer at most once per animation frame: the
  // path accumulates in the ref and a frame copies it into state.
  const lassoFrame = useRef<number | null>(null);
  const dropLassoFrame = () => {
    if (lassoFrame.current !== null && typeof cancelAnimationFrame === 'function')
      cancelAnimationFrame(lassoFrame.current);
    lassoFrame.current = null;
  };
  const cancelLasso = () => {
    dropLassoFrame();
    lassoRef.current = null;
    setLasso(null);
  };
  useEffect(() => {
    dropLassoFrame();
    lassoRef.current = null;
    setLasso(null);
  }, [fitId]);
  useEffect(() => dropLassoFrame, []);
  const onSurfaceDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!onLasso || event.button !== 0) return;
    // A point keeps its click (focus) and Shift-click (select).
    if ((event.target as Element).closest?.('[data-datum-id]')) return;
    event.preventDefault();
    // Escape after the drag reaches this frame (it clears the lasso's selection).
    svg.current?.focus({ preventScroll: true });
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // A synthetic pointer has no capture; the drag still works inside the frame.
    }
    lassoRef.current = {
      path: [toFrame(event.clientX, event.clientY)],
      mode: isAdditive(event) ? 'union' : 'replace',
    };
    setLasso([...lassoRef.current.path]);
  };
  const onSurfaceMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const current = lassoRef.current;
    if (!current) return;
    current.path.push(toFrame(event.clientX, event.clientY));
    if (typeof requestAnimationFrame !== 'function') {
      setLasso([...current.path]);
      return;
    }
    if (lassoFrame.current !== null) return;
    lassoFrame.current = requestAnimationFrame(() => {
      lassoFrame.current = null;
      if (lassoRef.current) setLasso([...lassoRef.current.path]);
    });
  };
  const onSurfaceUp = (event: React.PointerEvent<SVGSVGElement>) => {
    const current = lassoRef.current;
    if (!current || !onLasso) return;
    const path = [...current.path, toFrame(event.clientX, event.clientY)];
    cancelLasso();
    const [x0, y0] = path[0];
    // A click on empty space (no real drag) selects nothing.
    if (path.length < 4 || !path.some(([x, y]) => Math.hypot(x - x0, y - y0) >= 4)) return;
    onLasso(
      fitted.filter((_, i) => insidePolygon(points[i][0], points[i][1], path)),
      current.mode,
    );
  };

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
          sourcePath={
            displayed?.query.request.members.find((m) => m.memberId === peek.memberId)?.sourcePath ?? null
          }
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
        data-scale={projection.scale}
        data-lasso={lasso ? 'drawing' : undefined}
        className={
          (square ? 'block aspect-square w-full' : 'block max-h-[360px] w-full') +
          (onLasso ? ' cursor-crosshair touch-none select-none outline-none' : '')
        }
        tabIndex={onLasso ? -1 : undefined}
        role="group"
        aria-label="Spatial MDS observations"
        aria-describedby={instructions}
        onPointerEnter={() => setPointerOn(true)}
        onPointerLeave={() => setPointerOn(false)}
        onPointerDown={onSurfaceDown}
        onPointerMove={onSurfaceMove}
        onPointerUp={onSurfaceUp}
        onPointerCancel={cancelLasso}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || event.defaultPrevented) return;
          if (lassoRef.current) {
            event.preventDefault();
            event.stopPropagation();
            cancelLasso();
          } else if (onClear && selected.size > 0) {
            event.preventDefault();
            event.stopPropagation();
            onClear();
          }
        }}
        // The frame itself takes focus after a lasso; only a point's focus shows the preview square.
        onFocus={(event) => {
          setHasFocus(event.target !== svg.current);
          setFocusWithin(true);
        }}
        onBlur={(event) => {
          const next = event.relatedTarget as Node | null;
          if (next && svg.current?.contains(next)) return;
          setHasFocus(false);
          setFocusWithin(false);
          if (
            peek &&
            !peek.pinned &&
            !pointerInPeek.current &&
            !(next && peekHost.current?.contains(next))
          )
            closePeek();
        }}
      >
        {focused !== undefined &&
          spokes.map((m) => (
            <line
              key={`line-${m.memberId}`}
              data-neighbour-line={m.memberId}
              x1={points[focused][0]}
              y1={points[focused][1]}
              x2={points[m.at][0]}
              y2={points[m.at][1]}
              stroke="var(--bf-text-muted)"
              strokeOpacity="0.45"
              strokeWidth="0.75"
              pointerEvents="none"
            />
          ))}
        {layout.groups.map((label) =>
          label.leader ? (
            <path
              key={`leader-${label.id}`}
              aria-hidden
              data-label-leader={label.id}
              d={`M${label.leader[0]},${label.leader[1]}L${label.leader[2]},${label.leader[3]}`}
              stroke="var(--bf-text-muted)"
              strokeOpacity="0.6"
              strokeWidth="0.75"
              fill="none"
              pointerEvents="none"
            />
          ) : null,
        )}
        {fitted.map((memberId, i) => {
          const isFocused = memberId === activeMemberId,
            isSelected = selected.has(memberId);
          const kind = marks?.get(memberId);
          const [x, y] = points[i];
          const { out, trueX, trueY } = projection.points[i];
          const [fitX, fitY] = coordinates[i];
          const where = out
            ? ` · outside the frame at (${fitX.toFixed(3)}, ${fitY.toFixed(3)}), drawn at its edge`
            : '';
          return (
            <g
              key={memberId}
              data-member={memberId}
              data-dim={hasSelection && !isSelected ? true : undefined}
              opacity={hasSelection && !isSelected ? UNSELECTED_OPACITY : undefined}
            >
              {out ? (
                // Off-scale: one small muted tick at the edge, toward where the point lies.
                <path
                  aria-hidden
                  data-edge-mark={memberId}
                  data-true-x={trueX}
                  data-true-y={trueY}
                  d={edgeTick(x, y, out, frame)}
                  stroke="var(--bf-text-muted)"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  fill="none"
                  pointerEvents="none"
                />
              ) : (
                groupMarkParts(kind ?? 'circle', x, y, MARK_R).map((part, p) => (
                  <path
                    key={p}
                    aria-hidden
                    data-glyph={kind ?? 'circle'}
                    d={part.d}
                    fill={part.filled ? INK : 'none'}
                    stroke={INK}
                    strokeWidth={part.filled ? 0 : 1.2}
                    pointerEvents="none"
                  />
                ))
              )}
              <circle
                ref={(el) => {
                  if (el) nodes.current.set(memberId, el);
                  else nodes.current.delete(memberId);
                }}
                data-datum-id={memberId}
                data-fit-x={fitX}
                data-fit-y={fitY}
                data-focused={isFocused || undefined}
                data-selected={isSelected || undefined}
                data-clamped={out ? true : undefined}
                data-mark={kind}
                cx={x}
                cy={y}
                r={HIT_R}
                // The mark is drawn under its (invisible) target.
                fill="transparent"
                className="cursor-pointer outline-none"
                role="button"
                tabIndex={memberId === cursorId ? 0 : -1}
                aria-label={`Focus relationship ${memberId}`}
                aria-description={out ? `Outside the frame, drawn at its edge; true position (${fitX.toFixed(3)}, ${fitY.toFixed(3)})` : undefined}
                aria-pressed={isSelected}
                aria-current={isFocused ? 'true' : undefined}
                aria-describedby={peek?.memberId === memberId ? peekId : undefined}
                onPointerEnter={() => onPointEnter(memberId)}
                onPointerLeave={onPointLeave}
                onFocus={() => setCursor(memberId)}
                onClick={(event) => {
                  setCursor(memberId);
                  if (isAdditive(event)) onToggle(memberId);
                  else populationProbeActions.focus(memberId);
                }}
                onKeyDown={(event) => onKeyDown(event, memberId)}
              >
                <title>{`${memberId}${where} · hover to preview · click to focus · Shift- or ${additiveKeyLabel()}-click to select`}</title>
              </circle>
            </g>
          );
        })}
        {linkedId !== null && index.has(linkedId) && (
          <ellipse
            aria-hidden
            data-mark="linked"
            cx={points[index.get(linkedId)!][0]}
            cy={points[index.get(linkedId)!][1]}
            rx={FOCUS_RING_R - 1}
            ry={FOCUS_RING_R - 1}
            fill="none"
            stroke="var(--bf-text-primary)"
            strokeWidth="1.5"
            pointerEvents="none"
          />
        )}
        {focused !== undefined && (
          <ellipse
            aria-hidden
            data-mark="focus"
            cx={points[focused][0]}
            cy={points[focused][1]}
            rx={FOCUS_RING_R}
            ry={FOCUS_RING_R}
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
            x={points[preview][0] - 11}
            y={points[preview][1] - 11}
            width="22"
            height="22"
            fill="none"
            stroke="var(--bf-text-primary)"
            strokeWidth="1"
            strokeDasharray="3 2"
            pointerEvents="none"
          />
        )}
        {spokes.map((m) => {
          const label = rankAt.get(m.memberId);
          return label ? (
          <text
            key={`rank-${m.memberId}`}
            aria-hidden
            data-neighbour-rank={m.rank}
            x={label.x}
            y={label.y}
            textAnchor="middle"
            fontSize="9"
            fill="var(--bf-text-secondary)"
            stroke="var(--bf-bg-panel)"
            strokeWidth="2.5"
            paintOrder="stroke"
            className="font-mono"
            pointerEvents="none"
          >
            {m.rank}
          </text>
          ) : null;
        })}
        {layout.extremes.map((label) => (
          <text
            key={`extreme-${label.id}`}
            aria-hidden
            data-point-label={label.id}
            x={label.x}
            y={label.y}
            textAnchor={label.anchor}
            fontSize="10"
            fill="var(--bf-text-muted)"
            stroke="var(--bf-bg-panel)"
            strokeWidth="3"
            paintOrder="stroke"
            className="font-mono"
            opacity={hasSelection && !selected.has(label.id) ? UNSELECTED_OPACITY : undefined}
            pointerEvents="none"
          >
            {label.text}
          </text>
        ))}
        {layout.groups.map((label) => (
          <text
            key={`group-${label.id}`}
            aria-hidden
            data-group-label={label.id}
            x={label.x}
            y={label.y}
            textAnchor={label.anchor}
            fontSize="10"
            fill="var(--bf-text-secondary)"
            stroke="var(--bf-bg-panel)"
            strokeWidth="3"
            paintOrder="stroke"
            className="font-mono"
            pointerEvents="none"
          >
            {label.text}
          </text>
        ))}
        {layout.focus && (
          <text
            aria-hidden
            data-focus-label={layout.focus.id}
            x={layout.focus.x}
            y={layout.focus.y}
            textAnchor={layout.focus.anchor}
            fontSize="10"
            fill="var(--bf-text-primary)"
            stroke="var(--bf-bg-panel)"
            strokeWidth="3"
            paintOrder="stroke"
            className="font-mono"
            pointerEvents="none"
          >
            {layout.focus.text}
          </text>
        )}
        {lasso && lasso.length > 1 && (
          <polygon
            aria-hidden
            data-mark="lasso"
            points={lasso.map((p) => p.join(',')).join(' ')}
            fill="var(--bf-text-primary)"
            fillOpacity="0.08"
            stroke="var(--bf-text-secondary)"
            strokeWidth="1"
            strokeDasharray="3 2"
            pointerEvents="none"
          />
        )}
      </svg>
      {offScale.length ? (
        <p
          className="m-0 text-bf-xs text-bf-text-muted"
          data-testid="scatter-off-scale"
          title={offScaleList(offScale, fitted, coordinates)}
        >
          {offScale.length} off-scale:{' '}
          <span className="font-mono">
            {offScale.map((i) => fitted[i].slice(prefix.length)).join(', ')}
          </span>
          {groupsOff.map(({ group, off }) => (
            <span key={group.id} className="block" data-off-scale-group={group.id}>
              {`${group.text} · ${off} off-scale`}
            </span>
          ))}
          <span className="sr-only">
            {`, drawn as ticks at the frame's edge: ${offScaleList(offScale, fitted, coordinates)}`}
          </span>
        </p>
      ) : null}
      <p id={instructions} className="sr-only">
        Arrow keys move between observations and preview each one. Enter focuses, Shift+Enter adds
        or removes it from the selection, Escape closes the preview, then clears the selection. P pins the preview; A, C and S
        switch its plane to axial, coronal or sagittal; Page Up and Page Down step its slice.
      </p>
      {peekNode && (bounds ? createPortal(peekNode, bounds) : peekNode)}
    </>
  );
}

/**
 * An off-scale point's tick: a short stroke from its clamped place (x, y) on
 * the frame's inner edge outward along `out`, kept inside the frame.
 */
function edgeTick(x: number, y: number, [ux, uy]: readonly [number, number], frame: ScatterFrame) {
  const reach = Math.min(TICK_LEN, frame.margin - 1);
  const x1 = Math.min(frame.w - 1, Math.max(1, x + ux * reach)),
    y1 = Math.min(frame.h - 1, Math.max(1, y + uy * reach));
  return `M${x},${y}L${x1},${y1}`;
}

/** The off-scale points with their true (fitted) positions, for the note's tooltip. */
function offScaleList(
  indices: readonly number[],
  fitted: readonly string[],
  coordinates: readonly (readonly [number, number])[],
) {
  return indices
    .map((i) => `${fitted[i]} at (${coordinates[i][0].toFixed(3)}, ${coordinates[i][1].toFixed(3)})`)
    .join('; ');
}

/** Even-odd test of a point against a closed polygon. */
function insidePolygon(x: number, y: number, vertices: readonly (readonly [number, number])[]) {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const [xi, yi] = vertices[i],
      [xj, yj] = vertices[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
