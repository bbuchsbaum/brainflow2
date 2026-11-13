import { Check } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SELECTED_EDGE, useRovingFocus } from '@/components/ui/bf';
import { sliceImagePointToWorld } from '@/components/views/sliceViewer';
import { cn } from '@/utils/cn';
import { isAdditive, isMacPlatform } from '@/utils/selectionModifier';
import { rectsOverlap, verticalNeighbour } from './montageModel';
// While a selection exists, the tiles outside it recede but stay legible
// (the tile / mark pairing lives in `subsetOpacity.ts`).
import { TILE_UNSELECTED_OPACITY } from './subsetOpacity';
import {
  MONTAGE_DRAG_THRESHOLD_PX,
  montageSelectionHint,
  MontageCellContext,
  clearTileBackground,
  commonIdPrefix,
  montageGridStyle,
  montageTileTitle,
  shortId,
  useMontageCell,
  useRevealFocusedTile,
  useTileFlip,
  type MontageSprites,
} from './montageTileSupport';

export interface MontageTileHandlers {
  focusedId: string | null;
  /** Subjects in an explicit selection (empty when nothing is selected). */
  selectedIds: ReadonlySet<string>;
  onFocus: (id: string) => void;
  onToggle: (id: string) => void;
  /** The value under the pointer, or null when it leaves the tiles. */
  onHover?: (hover: { id: string; value: number | null; world: [number, number, number] } | null) => void;
  /** A subject pointed at elsewhere (its point on the similarity map): outlined. */
  linkedId?: string | null;
  /** Open the subject on its own (double-click): the single-subject view. */
  onOpen?: (id: string) => void;
}

/** Focus: a 1 px light (`--primary`) outline around the image, drawn just
 * inside its edge (outlines paint over the image; the tile clips outside). */
const TILE_FOCUSED = 'outline outline-1 -outline-offset-1 outline-primary';
/** Selection: the amber selected edge on the image's left (the row rule),
 * laid over the image since an inset shadow would sit under the canvas. */
const TILE_SELECTED = SELECTED_EDGE;
/**
 * The amber focus ring, for keyboard focus only. A tile focused by a click
 * (WebKit matches `:focus-visible` after the surface focuses it on press)
 * shows no ring: the focused subject is marked by `TILE_FOCUSED`. The
 * surface says how focus last moved (`data-modality` on the `group/montage`
 * scroller).
 */
export const TILE_KEYBOARD_FOCUS_RING =
  'focus-visible:outline-none group-data-[modality=keyboard]/montage:focus-visible:z-10 group-data-[modality=keyboard]/montage:focus-visible:outline group-data-[modality=keyboard]/montage:focus-visible:outline-2 group-data-[modality=keyboard]/montage:focus-visible:-outline-offset-2 group-data-[modality=keyboard]/montage:focus-visible:outline-[var(--bf-border-focus)]';
/** Keys that only modify a click (Shift-click must not count as keyboard use). */
const MODIFIER_KEYS = new Set(['Shift', 'Meta', 'Control', 'Alt', 'CapsLock']);

/**
 * One subject: its slice, frameless on the panel (outside the head is
 * cleared), drawn from the page's one shared crop, and its ID in small muted
 * mono beneath it. `label` is the ID without the set's shared prefix; the
 * full ID stays in the tooltip and the accessible name.
 */
export function MontageTile({
  id,
  label = id,
  sprites,
  focusedId,
  selectedIds,
  onFocus,
  onToggle,
  onHover,
  linkedId = null,
  onOpen,
}: MontageTileHandlers & { id: string; label?: string; sprites: MontageSprites | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const position = sprites?.index.get(id);
  const member = position === undefined ? null : sprites!.cutouts.members[position];
  const [w, h] = sprites?.cutouts.plane.dim_px ?? [1, 1];
  const crop = sprites?.crop ?? { x: 0, y: 0, width: w, height: h };
  const { x: cropX, y: cropY, width: cw, height: ch } = crop;
  const focused = focusedId === id;
  const selected = selectedIds.has(id);
  const receded = selectedIds.size > 0 && !selected;
  const image = sprites?.image ?? null;
  const sheetColumns = sprites?.sheetColumns ?? 1;
  const mirrorX = sprites?.mirrorX ?? false;
  const background = sprites?.background ?? null;
  const cell = useMontageCell(id);
  useLayoutEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, cw, ch);
    if (!image || position === undefined) return;
    ctx.imageSmoothingEnabled = false;
    // Every tile is drawn from the same source rectangle within its cell.
    const sx = (position % sheetColumns) * w + cropX,
      sy = Math.floor(position / sheetColumns) * h + cropY;
    if (mirrorX) {
      ctx.save();
      ctx.translate(cw, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(image, sx, sy, cw, ch, 0, 0, cw, ch);
      ctx.restore();
    } else {
      ctx.drawImage(image, sx, sy, cw, ch, 0, 0, cw, ch);
    }
    if (background && typeof ctx.getImageData === 'function') {
      const pixels = ctx.getImageData(0, 0, cw, ch);
      clearTileBackground(
        pixels.data,
        { x: cropX, y: cropY, width: cw, height: ch },
        w,
        background,
        mirrorX,
      );
      ctx.putImageData(pixels, 0, 0);
    }
  }, [image, position, sheetColumns, w, h, mirrorX, cropX, cropY, cw, ch, background]);
  return (
    <button
      type="button"
      {...cell}
      data-datum-id={id}
      data-montage-cell
      data-linked={linkedId === id || undefined}
      data-focused={focused || undefined}
      data-receded={receded || undefined}
      aria-label={`Focus subject ${id}`}
      aria-current={focused ? 'true' : undefined}
      aria-pressed={selected}
      title={montageTileTitle(id, member, selected)}
      onClick={(event) => (isAdditive(event) ? onToggle(id) : onFocus(id))}
      onDoubleClick={(event) => {
        if (isAdditive(event) || !onOpen) return;
        onOpen(id);
      }}
      onKeyDown={(event) => {
        if (event.shiftKey && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onToggle(id);
        }
      }}
      onMouseMove={(event) => {
        if (!onHover || !member || !canvas.current || !sprites) return;
        const bounds = canvas.current.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;
        const x = (event.clientX - bounds.left) / bounds.width,
          y = (event.clientY - bounds.top) / bounds.height;
        if (x < 0 || y < 0 || x >= 1 || y >= 1) return;
        const column = Math.min(cw - 1, Math.floor(x * cw));
        const px = cropX + (mirrorX ? cw - 1 - column : column),
          py = cropY + Math.min(ch - 1, Math.floor(y * ch));
        const value = member.values[py * w + px];
        onHover({
          id,
          value: value === null || !Number.isFinite(value) ? null : value,
          world: sliceImagePointToWorld(px, py, sprites.cutouts.plane),
        });
      }}
      // Frameless: no border, no box; the panel is the ground. Keyboard focus
      // keeps the shared amber ring (inside the tile: the grid runs to the
      // gutter); a click never draws it.
      className={cn(
        'relative flex min-w-0 flex-col overflow-hidden rounded-sm bg-transparent p-0 text-left',
        TILE_KEYBOARD_FOCUS_RING,
      )}
    >
      <span
        data-tile-image
        className={cn(
          'relative block w-full motion-safe:transition-opacity motion-safe:duration-150',
          focused && TILE_FOCUSED,
        )}
        style={receded ? { opacity: TILE_UNSELECTED_OPACITY } : undefined}
      >
        <canvas
          ref={canvas}
          width={cw}
          height={ch}
          aria-hidden
          // Colour is data: a tile enlarged from its sampled size is drawn pixel
          // for pixel, since smoothing would blend neighbouring colours into ones
          // the scale does not have. Only a tile shown smaller is averaged down.
          data-rendering={sprites?.pixelated === false ? 'smooth' : 'pixelated'}
          style={{ aspectRatio: `${cw} / ${ch}` }}
          className={
            sprites?.pixelated === false
              ? 'pointer-events-none block w-full'
              : 'pointer-events-none block w-full [image-rendering:pixelated]'
          }
        />
        {selected && (
          <span
            aria-hidden
            data-tile-selected-edge
            className={cn('pointer-events-none absolute inset-0 z-[1]', TILE_SELECTED)}
          />
        )}
        {linkedId === id && (
          <span
            aria-hidden
            data-tile-linked-edge
            // Lighter than focus (1 px --primary outline): a hairline in muted text.
            className="pointer-events-none absolute inset-0 z-[1] rounded-sm border border-bf-text-muted/60"
          />
        )}
        {member?.validPixels === 0 && (
          <span className="pointer-events-none absolute inset-x-0 top-1/3 text-center text-bf-xs text-bf-text-muted">
            No coverage
          </span>
        )}
      </span>
      <span
        data-tile-label
        className={cn(
          'flex h-4 shrink-0 items-center gap-1 font-mono text-bf-2xs leading-none',
          focused ? 'text-bf-text-primary' : 'text-bf-text-muted',
        )}
        style={receded ? { opacity: TILE_UNSELECTED_OPACITY } : undefined}
      >
        {/* Leading, so the mark reads with its own name: trailing, it sat at
            the column's right edge, next to the following tile's label. */}
        {selected && (
          <Check aria-hidden strokeWidth={3} className="h-2.5 w-2.5 shrink-0 text-bf-text-primary" />
        )}
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </span>
    </button>
  );
}

interface Drag {
  x: number;
  /** Where the press began, in the scrolled content's own coordinates. */
  contentY: number;
  lastX: number;
  lastY: number;
  additive: boolean;
  pointerId: number;
  active: boolean;
}

/** Distance from the top or bottom edge within which a drag scrolls the grid. */
const AUTO_SCROLL_EDGE_PX = 28;
const AUTO_SCROLL_MAX_PX = 16;
const AUTO_SCROLL_TICK_MS = 16;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/**
 * The scrolling ground the tiles sit on. A press that travels becomes a drag
 * selection over every tile the rectangle touches inside the visible grid
 * (Shift adds to the selection, Escape cancels, the grid scrolls when the
 * pointer nears its top or bottom); a press that stays put is the tile's own
 * click. The grid is one tab stop: arrow keys move between tiles, and Escape
 * clears the selection.
 */
export function MontageSurface({
  columns,
  cellIds,
  activeId,
  scope,
  onSelect,
  onClearSelection,
  hasSelection = false,
  onWidth,
  onHeight,
  onHoverEnd,
  children,
}: {
  columns: number;
  /** Every focusable cell (tile) in screen order. */
  cellIds: readonly string[];
  /** The cell that holds the tab stop until focus moves (the focused subject). */
  activeId: string | null;
  /** A new scope (another request) abandons a drag in progress. */
  scope: string;
  onSelect: (ids: string[], additive: boolean) => void;
  onClearSelection?: () => void;
  hasSelection?: boolean;
  /** The width tiles may fill, as measured. */
  onWidth?: (width: number) => void;
  /** The height of the visible grid, as measured (the tile size is fitted to it). */
  onHeight?: (height: number) => void;
  onHoverEnd?: () => void;
  children: ReactNode;
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  /** A drag was cancelled while its press is still down. */
  const escaped = useRef(false);
  const scrollSpeed = useRef(0);
  const scrollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [rect, setRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const dragging = rect !== null;
  // How focus last moved within the grid: a press, or the keyboard (also
  // the state on entering by Tab). Only keyboard focus draws the amber ring.
  const [modality, setModality] = useState<'pointer' | 'keyboard'>('keyboard');
  const roving = useRovingFocus({ ids: cellIds, activeId, orientation: 'horizontal' });
  const stopScroll = () => {
    scrollSpeed.current = 0;
    if (scrollTimer.current !== null) clearInterval(scrollTimer.current);
    scrollTimer.current = null;
  };
  const cancel = () => {
    const current = drag.current;
    drag.current = null;
    stopScroll();
    if (current?.active) scroller.current?.releasePointerCapture?.(current.pointerId);
    setRect(null);
  };
  const swallowNextClick = () => {
    suppressClick.current = true;
    setTimeout(() => {
      suppressClick.current = false;
    }, 0);
  };
  /** The drag rectangle from the press to the pointer, kept inside the visible grid. */
  const area = (start: Drag) => {
    const view = scroller.current!.getBoundingClientRect();
    const top = scroller.current!.scrollTop;
    const x = clamp(start.lastX, view.left, view.right);
    const y = clamp(start.lastY, view.top, view.bottom) - view.top + top;
    return {
      left: Math.min(start.x, x),
      right: Math.max(start.x, x),
      top: Math.min(start.contentY, y),
      bottom: Math.max(start.contentY, y),
      view,
      scrollTop: top,
    };
  };
  const draw = (start: Drag) => {
    if (!wrapper.current || !scroller.current) return;
    const bounds = wrapper.current.getBoundingClientRect();
    const box = area(start);
    setRect({
      left: box.left - bounds.left,
      top: box.top - box.scrollTop + box.view.top - bounds.top,
      width: box.right - box.left,
      height: box.bottom - box.top,
    });
  };
  useEffect(() => {
    drag.current = null;
    stopScroll();
    setRect(null);
  }, [scope]);
  useEffect(() => stopScroll, []);
  useEffect(() => {
    if (!dragging) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      // The press is still down: its release must not act as a click.
      escaped.current = true;
      cancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // `cancel` touches only refs and a state setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);
  const latestWidth = useRef(onWidth);
  latestWidth.current = onWidth;
  useEffect(() => {
    if (!content.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (next > 0) latestWidth.current?.(next);
    });
    observer.observe(content.current);
    return () => observer.disconnect();
  }, []);
  const latestHeight = useRef(onHeight);
  latestHeight.current = onHeight;
  useEffect(() => {
    if (!wrapper.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect.height ?? 0);
      if (next > 0) latestHeight.current?.(next);
    });
    observer.observe(wrapper.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={wrapper} className="relative min-h-0 flex-1 overflow-hidden">
      <div
        ref={scroller}
        data-montage-scroller
        aria-label="Subjects"
        role="group"
        title={`${montageSelectionHint()} · double-click opens a subject on its own`}
        data-modality={modality}
        // No top padding: the first row (or a group's sticky heading) sits
        // directly under the toolbar's hairline.
        className="group/montage absolute inset-0 select-none overflow-y-auto overflow-x-hidden"
        onMouseLeave={onHoverEnd}
        onBlur={(event) => {
          // The window itself lost focus (⌘-Tab away): focus comes back to
          // the same tile with the same modality, so keep it — otherwise the
          // ring would appear after a click once the user returns.
          if (typeof document !== 'undefined' && !document.hasFocus()) return;
          // Leaving the grid: the next entry (Tab, or a press) says how.
          if (!scroller.current?.contains(event.relatedTarget as Node | null)) setModality('keyboard');
        }}
        onPointerDown={(event) => {
          escaped.current = false;
          setModality('pointer');
          // Only a primary press starts a drag: not a context-menu press
          // (Ctrl-click on a Mac; elsewhere Ctrl is the additive key), and
          // not one on the scrollbar.
          if (event.button !== 0 || (event.ctrlKey && isMacPlatform()) || !scroller.current) return;
          const target = event.target as Element;
          if (target.closest?.('[data-montage-nodrag]')) return;
          const view = scroller.current.getBoundingClientRect();
          if (scroller.current.clientWidth > 0 && event.clientX > view.left + scroller.current.clientWidth)
            return;
          // WebKit does not focus a button on click: do it, so keys reach the grid.
          target.closest<HTMLElement>('[data-montage-cell]')?.focus?.({ preventScroll: true });
          drag.current = {
            x: event.clientX,
            contentY: event.clientY - view.top + scroller.current.scrollTop,
            lastX: event.clientX,
            lastY: event.clientY,
            additive: isAdditive(event),
            pointerId: event.pointerId,
            active: false,
          };
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start || !scroller.current) return;
          // The button came up somewhere this element never heard of: no drag.
          if ((event.buttons & 1) === 0) {
            cancel();
            return;
          }
          start.lastX = event.clientX;
          start.lastY = event.clientY;
          const view = scroller.current.getBoundingClientRect();
          if (
            !start.active &&
            Math.hypot(
              event.clientX - start.x,
              event.clientY - view.top + scroller.current.scrollTop - start.contentY,
            ) < MONTAGE_DRAG_THRESHOLD_PX
          )
            return;
          if (!start.active) {
            start.active = true;
            scroller.current.setPointerCapture?.(start.pointerId);
          }
          const above = view.top + AUTO_SCROLL_EDGE_PX - event.clientY,
            below = event.clientY - (view.bottom - AUTO_SCROLL_EDGE_PX);
          scrollSpeed.current =
            above > 0
              ? -Math.min(AUTO_SCROLL_MAX_PX, Math.ceil(above / 2))
              : below > 0
                ? Math.min(AUTO_SCROLL_MAX_PX, Math.ceil(below / 2))
                : 0;
          if (scrollSpeed.current === 0) stopScroll();
          else if (scrollTimer.current === null)
            scrollTimer.current = setInterval(() => {
              const current = drag.current;
              if (!current?.active || !scroller.current) return;
              scroller.current.scrollTop += scrollSpeed.current;
              draw(current);
            }, AUTO_SCROLL_TICK_MS);
          draw(start);
        }}
        onPointerCancel={cancel}
        onPointerUp={(event) => {
          const start = drag.current;
          if (start) {
            start.lastX = event.clientX;
            start.lastY = event.clientY;
          }
          const box = start?.active && scroller.current ? area(start) : null;
          cancel();
          if (escaped.current) {
            escaped.current = false;
            swallowNextClick();
            return;
          }
          if (!box || !scroller.current) return;
          // The press ended a drag: the click that follows is not a focus.
          swallowNextClick();
          const ids: string[] = [];
          scroller.current.querySelectorAll<HTMLElement>('[data-datum-id]').forEach((tile) => {
            const id = tile.getAttribute('data-datum-id');
            const bounds = tile.getBoundingClientRect();
            const shift = box.scrollTop - box.view.top;
            if (
              id &&
              rectsOverlap(box, {
                left: bounds.left,
                right: bounds.right,
                top: bounds.top + shift,
                bottom: bounds.bottom + shift,
              })
            )
              ids.push(id);
          });
          if (ids.length) onSelect(ids, start!.additive);
        }}
        onClickCapture={(event) => {
          if (!suppressClick.current) return;
          suppressClick.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
        onKeyDown={(event) => {
          if (!MODIFIER_KEYS.has(event.key)) setModality('keyboard');
          if (event.key === 'Escape' && !dragging && hasSelection && onClearSelection) {
            event.preventDefault();
            onClearSelection();
            return;
          }
          const vertical = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
          const cell = (event.target as Element).closest?.<HTMLElement>('[data-montage-cell]');
          if (
            vertical &&
            cell &&
            scroller.current &&
            !(event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
          ) {
            // Rows differ in length (a group's last row): move
            // to the cell actually above or below, by where the cells are.
            const cells = [...scroller.current.querySelectorAll<HTMLElement>('[data-montage-cell]')];
            const next = verticalNeighbour(
              cells.map((element) => element.getBoundingClientRect()),
              cells.indexOf(cell),
              vertical,
            );
            // The arrows belong to the grid here, not to a slice shortcut.
            event.preventDefault();
            event.stopPropagation();
            const id = next === null ? null : cells[next].getAttribute('data-roving-id');
            if (id) roving.focus(id);
            return;
          }
          roving.onKeyDown(event);
        }}
      >
        <div ref={content} className="pb-3" data-columns={columns}>
          <MontageCellContext.Provider value={roving.getItemProps}>
            {children}
          </MontageCellContext.Provider>
        </div>
      </div>
      {rect && (
        <div
          aria-hidden
          data-testid="montage-drag-rect"
          className="pointer-events-none absolute border border-primary bg-primary/15"
          style={rect}
        />
      )}
    </div>
  );
}

/** Every subject of the page in one grid. */
export function MontageGrid({
  ids,
  columns,
  sprites,
  idPrefix,
  ...handlers
}: MontageTileHandlers & {
  ids: readonly string[];
  columns: number;
  sprites: MontageSprites | null;
  /** The prefix every ID in the set shares ("sub-"), stripped from the labels; said once in the toolbar. */
  idPrefix?: string;
}) {
  const key = useMemo(() => ids.join('\n'), [ids]);
  const prefix = useMemo(() => idPrefix ?? commonIdPrefix(ids), [idPrefix, ids]);
  const host = useRevealFocusedTile(handlers.focusedId, `${key}:${columns}`);
  useTileFlip(host, key, String(columns));
  return (
    <div ref={host}>
      <div className="grid" style={montageGridStyle(columns)}>
        {ids.map((id) => (
          <MontageTile
            key={id}
            id={id}
            label={shortId(id, prefix)}
            sprites={sprites}
            {...handlers}
          />
        ))}
      </div>
    </div>
  );
}
