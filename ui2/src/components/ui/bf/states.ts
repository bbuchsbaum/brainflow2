/**
 * Shared state classes for the `bf` primitives (HYBRID rules 3-4, V5 amendment).
 *
 * Every interactive state is written twice: once on the real pseudo-class
 * (`:focus-visible`, `:hover`) and once on a `data-force-*` attribute. The
 * attribute twin exists only so the dev gallery (primitives-harness.html) can
 * pin a state for a still screenshot; app code never sets it.
 *
 * Focus and selection differ in FORM, not just colour:
 * - focus is a 2px amber outline, separated from whatever it surrounds by a
 *   gap. Exactly two geometries exist: OUTER (offset 1, square corners) for
 *   free-standing controls, and INSET (border-aware) for rows and headers
 *   inside scrollers;
 * - selection is the one selected fill (`--bf-bg-active`, #36383d, shared by
 *   rows, tabs, segments and chips) plus a 2px inset amber LEFT edge on rows.
 *
 * Active edges (tabs, segments, filter chips) stay visible under keyboard
 * focus when they are NEUTRAL: the ring is amber and the edge grey, so they
 * never read as one double band. Only an AMBER edge (focused GoldenLayout
 * stack, workspace switcher) hides while focused.
 *
 * Focus is drawn with `outline`, not `box-shadow`, so it survives forced
 * colors (Windows High Contrast removes box-shadows). Box-shadow state edges
 * get a forced-colors twin drawn as a pseudo-element in a system colour.
 */

// ── heights (one scale for every primitive) ──────────────────────────────────

/** Height scale in px: tags/pills, controls (inputs, segments, rows, buttons), tab strips, section headers. */
export const BF_HEIGHT = { tag: 20, control: 24, tab: 28, sectionHeader: 32 } as const;
/** Tailwind classes for {@link BF_HEIGHT} (literal strings so the JIT sees them). */
export const H_TAG = 'h-5';
export const H_CONTROL = 'h-6';
export const H_TAB = 'h-7';
export const H_SECTION_HEADER = 'h-8';

// ── focus ────────────────────────────────────────────────────────────────────

/**
 * OUTER focus ring: 2px outline, 1px gap, square corners (the element drops
 * its 2px radius while focused so the outline is a true rectangle), lifted
 * above joined neighbours. Buttons, chips, tabs, segments, inputs, thumbs.
 */
export const FOCUS_RING =
  'focus-visible:z-10 focus-visible:rounded-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--bf-border-focus)] data-[force-focus]:z-10 data-[force-focus]:rounded-none data-[force-focus]:outline data-[force-focus]:outline-2 data-[force-focus]:outline-offset-1 data-[force-focus]:outline-[var(--bf-border-focus)]';

/** @deprecated Alias of {@link FOCUS_RING}; there is one outer geometry. */
export const FOCUS_RING_WIDE = FOCUS_RING;

/** Width of the selection edge and of the focus ring, px. */
export const SELECTION_EDGE_PX = 2;
export const FOCUS_RING_PX = 2;

/**
 * INSET focus ring for a borderless full-width row or section header
 * (scroll containers clip an outer ring). `outline-offset:-6px` puts the 2px
 * ring 4-5px inside the box: edge (0-1) · gap (2-3) · ring (4-5), a 2px gap.
 */
export const FOCUS_RING_INSET =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--bf-border-focus)] focus-visible:[outline-offset:-6px] data-[force-focus]:outline data-[force-focus]:outline-2 data-[force-focus]:outline-[var(--bf-border-focus)] data-[force-focus]:[outline-offset:-6px]';

/**
 * INSET focus ring for a row with a 1px border (cards). The inset selection
 * edge is painted inside the border, so the ring moves in by the border
 * width: border (0) · edge (1-2) · gap (3-4) · ring (5-6).
 */
export const FOCUS_RING_INSET_BORDERED =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--bf-border-focus)] focus-visible:[outline-offset:-7px] data-[force-focus]:outline data-[force-focus]:outline-2 data-[force-focus]:outline-[var(--bf-border-focus)] data-[force-focus]:[outline-offset:-7px]';

/**
 * Pixel bands (measured from the outer border edge, inclusive ranges) of an
 * inset selection edge and an inset focus ring. Used by the geometry tests to
 * prove the two never touch.
 */
export function insetBands(borderPx: number, outlineOffsetPx: number) {
  const edge: [number, number] = [borderPx, borderPx + SELECTION_EDGE_PX - 1];
  // A negative outline-offset moves the outline's OUTER edge inwards by
  // |offset| - width: offset -6, width 2 -> pixels 4..5.
  const ringStart = -outlineOffsetPx - FOCUS_RING_PX;
  const ring: [number, number] = [ringStart, ringStart + FOCUS_RING_PX - 1];
  return { edge, ring, gap: ring[0] - edge[1] - 1 };
}

// ── hover / selection / active ──────────────────────────────────────────────

/** Neutral hover fill (the shadcn `--accent` is the neutral hover token). */
export const HOVER_FILL = 'hover:bg-accent data-[force-hover]:bg-accent';

/** The one selected / active fill (#36383d) for rows, tabs, segments and chips. */
export const SELECTED_FILL = 'bg-bf-bg-active';

/**
 * Forced-colors twin of an inset LEFT edge: a 3px `Highlight` bar drawn as a
 * pseudo-element (box-shadows are dropped in forced colors).
 */
export const FORCED_LEFT_EDGE =
  "forced-colors:before:absolute forced-colors:before:inset-y-0 forced-colors:before:left-0 forced-colors:before:w-[3px] forced-colors:before:bg-[Highlight] forced-colors:before:content-[''] forced-colors:before:[forced-color-adjust:none]";

/** Forced-colors twin of an inset BOTTOM edge (active tab / segment / chip). */
export const FORCED_BOTTOM_EDGE =
  "forced-colors:after:absolute forced-colors:after:inset-x-0 forced-colors:after:bottom-0 forced-colors:after:h-[3px] forced-colors:after:bg-[Highlight] forced-colors:after:content-[''] forced-colors:after:[forced-color-adjust:none]";

/** Selection: the selected fill + 2px inset amber left edge (+ forced-colors bar). */
/**
 * The 2px amber selected-row edge on its own, for composites (menus, listbox
 * options, command-palette rows) that keep their own fill. `_FOCUS` draws it
 * only for the keyboard-focused item (menus whose focus IS the selection).
 */
/** The selection-edge colour, for SVG marks that draw the edge as a stroke. */
export const SELECTED_EDGE_COLOR = 'var(--bf-accent)';
export const SELECTED_EDGE = 'shadow-[inset_2px_0_0_var(--bf-accent)]';
export const SELECTED_EDGE_FOCUS = 'focus-visible:shadow-[inset_2px_0_0_var(--bf-accent)]';

export const SELECTED = `${SELECTED_FILL} text-foreground ${SELECTED_EDGE} ${FORCED_LEFT_EDGE}`;

/** Neutral active bottom edge: stays visible under focus (grey edge, amber ring). */
export const EDGE_NEUTRAL = `shadow-[inset_0_-2px_0_var(--bf-text-muted)] ${FORCED_BOTTOM_EDGE}`;

/** Amber active bottom edge: hidden while focused so amber never doubles. */
export const EDGE_ACCENT = `shadow-[inset_0_-2px_0_var(--bf-accent)] focus-visible:shadow-none data-[force-focus]:shadow-none ${FORCED_BOTTOM_EDGE}`;

/**
 * Forced-colors twin of an inset 1px OUTLINE (active segment): a 2px
 * `Highlight` frame drawn as a pseudo-element.
 */
export const FORCED_FRAME =
  "forced-colors:after:absolute forced-colors:after:inset-0 forced-colors:after:border-2 forced-colors:after:border-[Highlight] forced-colors:after:content-[''] forced-colors:after:[forced-color-adjust:none]";

/**
 * Hover cue on an "on" item: the light fill only brightens 1.16:1, so hover
 * also draws a 1px dark inner frame (`--primary-foreground`, ~15:1 against
 * the fill), a form change rather than a faint tint. A focused item keeps its
 * FOCUS_GAP shadow instead (focus-visible is ordered after hover).
 */
export const ON_HOVER_FRAME =
  'hover:shadow-[inset_0_0_0_1px_hsl(var(--primary-foreground))] data-[force-hover]:shadow-[inset_0_0_0_1px_hsl(var(--primary-foreground))]';

/**
 * The "on" state of a value choice: active SEGMENT and pressed FILTER CHIP
 * (user decision 2026-10-26, HYBRID rule 2): the light-neutral `--primary`
 * fill with dark `--primary-foreground` text, no outline, no bottom edge.
 * Tabs keep their bottom edge; the top-bar workspace switcher keeps its amber
 * edge (`EDGE_ACCENT`). Hover on the on item brightens to `--foreground` and
 * draws the dark inner frame (`ON_HOVER_FRAME`).
 * Forced colors: the fill is dropped, so a 2px `Highlight` frame stands in.
 */
export const ON_FILL = `bg-primary text-primary-foreground hover:bg-[hsl(var(--foreground))] data-[force-hover]:bg-[hsl(var(--foreground))] ${ON_HOVER_FRAME} ${FORCED_FRAME}`;

/** @see ON_FILL (the active segment). */
export const SEGMENT_ACTIVE = ON_FILL;

/**
 * Dark 1px gap under the OUTER focus ring (fills the outline-offset band) for
 * controls that can carry the light `ON_FILL` or sit next to one: amber on
 * the light fill is only 1.6:1, against this gap 7.6:1 (and >= 5.2:1 against
 * every panel ground), so the ring always reads. Not for `EDGE_ACCENT` items
 * (their focus state drops the shadow).
 */
export const FOCUS_GAP =
  'focus-visible:shadow-[0_0_0_1px_var(--bf-bg-app)] data-[force-focus]:shadow-[0_0_0_1px_var(--bf-bg-app)]';

/** Disabled look shared by every primitive. */
export const DISABLED =
  'disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50';

/** Visually hidden but announced (separators inside accessible names). */
export const SR_ONLY = 'sr-only';
