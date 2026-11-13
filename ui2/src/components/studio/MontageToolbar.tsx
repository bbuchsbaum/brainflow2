import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUpDown, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import {
  Button,
  IconButton,
  SegmentedControl,
  Select,
  Slider,
  Toolbar,
  ToolbarField,
  ToolbarSeparator,
} from '@/components/ui/bf';
import type { PopulationOrientation } from '@/services/studio/PopulationSliceService';
import { StudioToolbarMore } from './StudioToolbarSlot';
import {
  MONTAGE_TOOLBAR_MAX_LEVEL,
  montageToolbarLayout,
  nearestTilePreset,
  presetTilesPerRow,
  type MontageOption,
  type MontageSortOptions,
  type MontageTilePreset,
} from './montageModel';

const option = (o: MontageOption) => (
  <option key={o.value} value={o.value} disabled={o.disabled} title={o.description}>
    {o.label}
  </option>
);
/** Options in order, consecutive ones with a heading under one optgroup. */
function groupedOptions(options: readonly MontageOption[]) {
  const out: ReactNode[] = [];
  for (let i = 0; i < options.length; ) {
    const heading = options[i].group;
    if (!heading) {
      out.push(option(options[i]));
      i += 1;
      continue;
    }
    const run: MontageOption[] = [];
    while (i < options.length && options[i].group === heading) run.push(options[i++]);
    out.push(
      <optgroup key={`group:${heading}`} label={heading}>
        {run.map(option)}
      </optgroup>,
    );
  }
  return out;
}

/** How long a keyboard choice must rest before it is acted on. */
export const MONTAGE_SELECT_SETTLE_MS = 500;
const STEPPING_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'];

/**
 * A select whose choices start work (a fit, a pin). Stepping through a closed
 * native select with the keyboard fires a change for every option passed, so a
 * keyboard change is acted on only once it settles (or on Enter, or when
 * focus leaves); a choice made with the pointer is acted on at once.
 */
function CommitSelect({
  value,
  onCommit,
  children,
  ...rest
}: Omit<React.ComponentProps<typeof Select>, 'value' | 'onChange' | 'onValueChange'> & {
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const keyboard = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The settle timer outlives the render that armed it: read the committed
  // value, the draft and the callback from the latest render, never a closure.
  const latest = useRef({ draft, value, onCommit });
  latest.current = { draft, value, onCommit };
  const settle = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    const pending = latest.current.draft;
    if (pending === null) return;
    setDraft(null);
    latest.current = { ...latest.current, draft: null };
    if (pending !== latest.current.value) latest.current.onCommit(pending);
  };
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <Select
      {...rest}
      value={draft ?? value}
      onPointerDown={() => {
        keyboard.current = false;
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') settle();
        else if (STEPPING_KEYS.includes(event.key) || event.key.length === 1) keyboard.current = true;
      }}
      onBlur={settle}
      onValueChange={(next) => {
        if (!keyboard.current) {
          if (timer.current !== null) clearTimeout(timer.current);
          timer.current = null;
          setDraft(null);
          onCommit(next);
          return;
        }
        setDraft(next);
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(settle, MONTAGE_SELECT_SETTLE_MS);
      }}
    >
      {children}
    </Select>
  );
}

/** A plain choice on the row (Show, Tiles, Zoom). */
export interface ToolbarChoice {
  label: string;
  value: string;
  options: readonly MontageOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  title?: string;
}

export interface MontageToolbarProps {
  /**
   * Montage: Sort, Reverse, Group, Slice, tile size (the tiles' extent is in
   * the ⋯ menu). Summary: Show, Group, Slice, Cutouts, Zoom.
   */
  mode?: 'montage' | 'summary';
  /** Summary: what the left pane shows (a statistic, or a test's channel). */
  show?: ToolbarChoice | null;
  /** Summary: the per-subject cutouts below the panes. */
  cutouts?: { shown: boolean; onToggle: () => void; disabledReason: string | null } | null;
  /** Summary: magnification. */
  zoom?: ToolbarChoice | null;
  sort: string;
  sortOptions: MontageSortOptions;
  /** The chosen order is still being computed. */
  sortBusy?: boolean;
  onSort: (value: string) => void;
  reversed: boolean;
  onReverse: () => void;
  group: string;
  groupOptions: readonly MontageOption[];
  groupBusy?: boolean;
  onGroup: (value: string) => void;
  /**
   * Grouped by similarity: how many groups. Folded into the Group select: the
   * closed select reads "r · 2 groups" (the measure's notation; the menu and
   * tooltip name it in full), and the counts are choices inside its menu.
   */
  groupCount?: {
    value: number;
    max: number;
    onChange: (count: number) => void;
    title?: string;
    /** The count is the fit's suggested one ("auto"). */
    auto?: boolean;
    /** The fit's suggested count, when known: marked in the menu. */
    suggested?: number | null;
    /**
     * What each cut of the tree yields: real groups and outliers (members
     * alone in their cluster). A count shown to the user never counts an
     * outlier as a group. Absent: every cluster is a group.
     */
    cuts?: readonly { count: number; groups: number; outliers: number }[] | null;
    /** Back to the fit's suggested count (the menu's "Auto (n)"). */
    onAuto?: () => void;
  } | null;
  orientation: PopulationOrientation;
  onOrientation: (orientation: PopulationOrientation) => void;
  /** "z −8.5 mm". */
  slice: string;
  canStep: boolean;
  onStep: (direction: -1 | 1) => void;
  /** Whole tiles in a row; they fill the width exactly. */
  tilesPerRow: number;
  tilesRange: { min: number; max: number };
  onTilesPerRow: (count: number) => void;
  /** Width the tiles fill (px), for the S / M / L sizes. */
  gridWidth: number;
}

/** A spinner beside a control whose choice is being computed. */
function Busy({ show, label }: { show: boolean; label: string }) {
  return show ? (
    <Loader2
      role="img"
      aria-label={label}
      data-testid="montage-busy"
      className="h-3.5 w-3.5 shrink-0 text-bf-text-secondary motion-safe:animate-spin"
    />
  ) : null;
}

const hiddenLabel = '[&>label]:sr-only';
/**
 * Every control keeps its own width: a field never shrinks under its select
 * and a select never under its text, so a row that does not fit is wider than
 * its box (measured, and stepped down) rather than drawn one control over
 * another.
 */
const keep = 'shrink-0';

/** A plain labelled choice (Show, Zoom; the tiles' extent in the ⋯ menu). */
export function Choice({ choice, showLabel }: { choice: ToolbarChoice; showLabel: boolean }) {
  return (
    <ToolbarField label={choice.label} className={showLabel ? keep : `${keep} ${hiddenLabel}`}>
      <Select
        className="w-auto min-w-16 max-w-44 shrink-0 truncate"
        aria-label={choice.label}
        value={choice.value}
        disabled={choice.disabled}
        title={choice.title ?? choice.options.find((o) => o.value === choice.value)?.description}
        onValueChange={choice.onChange}
      >
        {choice.options.map(option)}
      </Select>
    </ToolbarField>
  );
}

/** The prefix of a group-count choice inside the Group select. */
const COUNT_PREFIX = 'count:';
/** The most counts listed in the Group menu (a fit scores at most 8). */
const MAX_LISTED_COUNTS = 12;

const plural = (n: number) => `${n} ${n === 1 ? 'group' : 'groups'}`;
/** The menu's choice that returns the count to the fit's suggestion. */
const AUTO_COUNT = `${COUNT_PREFIX}auto`;

/** A cut of the tree as the user reads it: groups, then outliers apart ("2 groups + 1 outlier"). */
function cutText(count: number, cuts: NonNullable<MontageToolbarProps['groupCount']>['cuts']) {
  const cut = cuts?.find((c) => c.count === count);
  if (!cut) return plural(count);
  return cut.outliers
    ? `${plural(cut.groups)} + ${cut.outliers} ${cut.outliers === 1 ? 'outlier' : 'outliers'}`
    : plural(cut.groups);
}
/** The closed select's count: the groups, then "+3 outliers". */
function cutLabel(count: number, cuts: NonNullable<MontageToolbarProps['groupCount']>['cuts']) {
  const cut = cuts?.find((c) => c.count === count);
  if (!cut) return plural(count);
  return cut.outliers
    ? `${plural(cut.groups)} · +${cut.outliers} ${cut.outliers === 1 ? 'outlier' : 'outliers'}`
    : plural(cut.groups);
}
const groupsOf = (count: number, cuts: NonNullable<MontageToolbarProps['groupCount']>['cuts']) =>
  cuts?.find((c) => c.count === count)?.groups ?? count;

/** The Group select's choices, with the counts inside it when grouped by similarity. */
function groupChoices(
  options: readonly MontageOption[],
  group: string,
  count: MontageToolbarProps['groupCount'],
) {
  if (!count) return groupedOptions(options);
  const at = options.findIndex((o) => o.value === group);
  if (at < 0) return groupedOptions(options);
  const active = {
    ...options[at],
    label: `${options[at].short ?? options[at].label} · ${cutLabel(count.value, count.cuts)}`,
  };
  const top = Math.min(count.max, Math.max(count.value, MAX_LISTED_COUNTS));
  const counts = Array.from({ length: Math.max(0, top - 1) }, (_, i) => i + 2);
  const suggested = count.suggested ?? null;
  return [
    ...groupedOptions(options.slice(0, at)),
    option(active),
    <optgroup key="group-counts" label="Number of groups">
      {count.onAuto && suggested !== null ? (
        <option
          key="auto"
          value={AUTO_COUNT}
          data-current={count.auto || undefined}
          title="The fit's suggested number of groups"
        >
          {`${count.auto ? '✓ ' : ''}Auto (${groupsOf(suggested, count.cuts)})`}
        </option>
      ) : null}
      {counts.map((n) => (
        <option
          key={n}
          value={`${COUNT_PREFIX}${n}`}
          data-current={(n === count.value && !count.auto) || undefined}
          title={n === count.suggested ? 'The fit\'s suggested number of groups' : undefined}
        >
          {`${n === count.value && !(count.auto && count.onAuto) ? '✓ ' : ''}${cutText(n, count.cuts)}${n === count.suggested ? ' · suggested' : ''}`}
        </option>
      ))}
    </optgroup>,
    ...groupedOptions(options.slice(at + 1)),
  ];
}

/**
 * The montage's one row of controls: what order, what groups (and how many),
 * which slice, how many tiles in a row. It never wraps and no control is ever
 * drawn over another: as the row narrows it drops the word "Slice", then the
 * other field words, shows three tile sizes in place of the slider, moves
 * them into a menu, and last narrows Sort and Group to a fixed width (they
 * truncate inside their own box). The slice readout always stays. What can be
 * done with a selection is not on this row (`PopulationMontage` gives it a
 * line of its own), so a selection never costs Sort, Group or Slice room.
 */
export function MontageToolbar({
  mode = 'montage',
  show = null,
  cutouts = null,
  zoom = null,
  sort,
  sortOptions,
  sortBusy = false,
  onSort,
  reversed,
  onReverse,
  group,
  groupOptions,
  groupBusy = false,
  onGroup,
  groupCount = null,
  orientation,
  onOrientation,
  slice,
  canStep,
  onStep,
  tilesPerRow,
  tilesRange,
  onTilesPerRow,
  gridWidth,
}: MontageToolbarProps) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!root.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect.width ?? 0);
      setWidth((previous) => (previous === next ? previous : next));
    });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  // The layout follows what fits, not a guess at widths: whenever the row or
  // its content changes it starts from the full layout and steps down while
  // the content is wider than the row (long column names, a narrow pane).
  const [level, setLevel] = useState(0);
  // Everything that changes the row's width: the spinners come and go with a
  // computation, the Group select's label carries the group count, the slice
  // readout's length (tabular figures: its width follows its length), the
  // orientation select's word, and the summary's Show / Zoom / Cutouts
  // controls (their chosen labels).
  const choiceKey = (choice: ToolbarChoice | null) =>
    choice
      ? `${choice.label}=${choice.options.find((o) => o.value === choice.value)?.label ?? choice.value}${choice.disabled ? '!' : ''}`
      : '-';
  const contentKey = [
    mode,
    width,
    sort,
    group,
    sortOptions.columns.length,
    groupOptions.length,
    tilesRange.max,
    sortBusy,
    groupBusy,
    groupCount ? `${cutLabel(groupCount.value, groupCount.cuts)}:${groupCount.max}:${groupCount.auto ? 'auto' : ''}` : '-',
    orientation,
    slice.length,
    choiceKey(show),
    choiceKey(zoom),
    cutouts ? `cutouts${cutouts.shown ? '+' : ''}${cutouts.disabledReason === null ? '' : '!'}` : '-',
  ].join(':');
  const measuredFor = useRef(contentKey);
  useLayoutEffect(() => {
    const row = root.current;
    if (!row) return;
    if (measuredFor.current !== contentKey) {
      measuredFor.current = contentKey;
      if (level !== 0) {
        setLevel(0);
        return;
      }
    }
    if (row.scrollWidth > row.clientWidth && level < MONTAGE_TOOLBAR_MAX_LEVEL) setLevel(level + 1);
  }, [contentKey, level]);
  const layout = montageToolbarLayout(level);
  const presets = (
    <SegmentedControl
      aria-label="Tile size"
      className="shrink-0"
      hideWhenSingle={false}
      options={(['S', 'M', 'L'] as const).map((preset) => ({
        value: preset,
        label: preset,
        'aria-label': preset === 'S' ? 'Small tiles' : preset === 'M' ? 'Medium tiles' : 'Large tiles',
      }))}
      value={nearestTilePreset(tilesPerRow, gridWidth)}
      onValueChange={(preset) =>
        onTilesPerRow(presetTilesPerRow(preset as MontageTilePreset, gridWidth))
      }
    />
  );
  return (
    <Toolbar
      ref={root}
      aria-label={mode === 'montage' ? 'Montage' : 'Summary'}
      data-level={level}
      data-layout={`${layout.sliceLabel ? 'slice-word ' : ''}${layout.fieldLabels ? 'field-words ' : ''}${layout.tileControl}${layout.compactSelects ? ' compact-selects' : ''}`}
      className="min-w-0 flex-1 flex-nowrap gap-x-3 p-0"
    >
      {mode === 'summary' && show ? (
        <div className="flex shrink-0 items-center gap-1">
          <Choice choice={show} showLabel={layout.fieldLabels} />
        </div>
      ) : null}
      {mode === 'montage' ? (
      <div data-toolbar-segment="sort" className="flex shrink-0 items-center gap-1">
        <ToolbarField label="Sort" className={layout.fieldLabels ? keep : `${keep} ${hiddenLabel}`}>
          <CommitSelect
            // Wide enough for "Value at pin" at the narrowest step, and never
            // narrower than its text before it.
            className={`shrink-0 truncate ${layout.compactSelects ? 'w-28' : 'w-auto min-w-28 max-w-44'}`}
            aria-busy={sortBusy || undefined}
            title={[...sortOptions.orders, ...sortOptions.columns].find((o) => o.value === sort)?.description}
            value={sort}
            onCommit={onSort}
          >
            {sortOptions.orders.map(option)}
            {sortOptions.columns.length > 0 && (
              <optgroup label="Design columns">{sortOptions.columns.map(option)}</optgroup>
            )}
          </CommitSelect>
        </ToolbarField>
        <Busy show={sortBusy} label="Computing the order" />
        {/* Clear of the Sort select's chevron. */}
        <IconButton
          className="ml-1 shrink-0"
          icon={<ArrowUpDown />}
          aria-label="Reverse order"
          aria-pressed={reversed}
          title={reversed ? 'Order is reversed' : 'Reverse the order'}
          onClick={onReverse}
        />
      </div>
      ) : null}
      <div data-toolbar-segment="group" className="flex shrink-0 items-center gap-1">
        <ToolbarField label="Group" className={layout.fieldLabels ? keep : `${keep} ${hiddenLabel}`}>
          <CommitSelect
            className={`shrink-0 truncate ${
              layout.compactSelects ? 'w-32' : `w-auto min-w-16 ${groupCount ? 'max-w-56' : 'max-w-44'}`
            }`}
            aria-busy={groupBusy || undefined}
            data-auto={groupCount?.auto || undefined}
            title={
              groupCount
                ? `${groupOptions.find((o) => o.value === group)?.description ?? 'Similarity groups'}. ${cutText(groupCount.value, groupCount.cuts)}${
                    groupCount.auto
                      ? ` (auto: the fit suggests ${plural(groupsOf(groupCount.value, groupCount.cuts))})`
                      : ''
                  }; choose another number in this menu. ${groupCount.title ?? 'Number of groups'}.`
                : groupOptions.find((o) => o.value === group)?.description
            }
            value={group}
            onCommit={(value) => {
              if (value === AUTO_COUNT) {
                groupCount?.onAuto?.();
                return;
              }
              if (value.startsWith(COUNT_PREFIX)) {
                groupCount?.onChange(Number(value.slice(COUNT_PREFIX.length)));
                return;
              }
              onGroup(value);
            }}
          >
            {groupChoices(groupOptions, group, groupCount)}
          </CommitSelect>
        </ToolbarField>
        <Busy show={groupBusy} label="Computing the groups" />
      </div>
      <ToolbarSeparator />
      <div data-toolbar-segment="slice" className="flex shrink-0 items-center gap-1.5">
        <ToolbarField label="Slice" className={layout.sliceLabel ? keep : `${keep} ${hiddenLabel}`}>
          <Select
            className="w-auto shrink-0"
            value={orientation}
            onValueChange={(value) => onOrientation(value as PopulationOrientation)}
          >
            <option value="axial">Axial</option>
            <option value="coronal">Coronal</option>
            <option value="sagittal">Sagittal</option>
          </Select>
        </ToolbarField>
        <div
          role="group"
          aria-label="Slice position"
          title={slice}
          className="inline-flex h-6 shrink-0 items-center rounded-sm border border-bf-border-field bg-bf-bg-input"
        >
          <IconButton
            className="h-full w-5 shrink-0"
            icon={<ChevronLeft />}
            aria-label="Previous slice"
            disabled={!canStep}
            onClick={() => onStep(-1)}
          />
          {/* Always shown: tabular figures in a fixed minimum width ("z −120.5 mm"),
              so stepping never shifts the row. */}
          <span
            aria-live="polite"
            data-testid="montage-slice-readout"
            className="min-w-[11ch] shrink-0 whitespace-nowrap px-1 text-center font-mono text-bf-sm tabular-nums text-foreground"
          >
            {slice}
          </span>
          <IconButton
            className="h-full w-5 shrink-0"
            icon={<ChevronRight />}
            aria-label="Next slice"
            disabled={!canStep}
            onClick={() => onStep(1)}
          />
        </div>
      </div>
      {mode === 'summary' && cutouts ? (
        <Button
          variant="secondary"
          size="sm"
          className="shrink-0"
          aria-pressed={cutouts.shown}
          disabled={cutouts.disabledReason !== null}
          title={cutouts.disabledReason ?? (cutouts.shown ? 'Hide the cutouts' : 'Show every subject at the pin')}
          onClick={cutouts.onToggle}
        >
          Cutouts
        </Button>
      ) : null}
      {mode === 'summary' && zoom ? <Choice choice={zoom} showLabel={layout.fieldLabels} /> : null}
      <span className="min-w-0 flex-1" />
      {/* Last on the row and never shrunk: the others give way first. */}
      {mode === 'summary' ? null : layout.tileControl === 'slider' ? (
        <Slider
          className="w-24 shrink-0"
          label="Tiles per row"
          min={tilesRange.min}
          max={Math.max(tilesRange.min + 1, tilesRange.max)}
          step={1}
          snap={1}
          fill={false}
          disabled={tilesRange.max <= tilesRange.min}
          value={tilesPerRow}
          valueText={(v) => `${Math.round(v)} tiles per row`}
          onValueChange={(v) => {
            const next = Math.round(v);
            if (next !== tilesPerRow) onTilesPerRow(next);
          }}
        />
      ) : layout.tileControl === 'presets' ? (
        presets
      ) : (
        // No room on the row: the sizes stay reachable in a menu, never cut off.
        <StudioToolbarMore label="Tile size" iconOnly>
          {presets}
        </StudioToolbarMore>
      )}
    </Toolbar>
  );
}
