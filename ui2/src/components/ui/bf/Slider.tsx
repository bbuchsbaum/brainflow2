import React, { forwardRef, useEffect, useRef, useState } from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '@/utils/cn';
import { makeRuler, NON_LABELABLE, snapToPrecision, roundForAria, rulerDomain, SLIDER_THUMB_INSET_PX } from './helpers';
import { formatLayerValue, formatLayerValueAscii, formatRange } from '@/utils/valueFormat';
import { HIDDEN_BAND_BACKGROUND } from '@/components/views/viewportFrame/frameFormat';
import { ValueChip } from './ValueChip';

/**
 * One slider for the product (single value and range), replacing the
 * Inspector's native ranges, RangeBlock/DualRangeTrack, the crosshair dialog
 * sliders and (as `variant="rail"`) the viewport/mosaic slice scrubber.
 *
 * Ruler contract (shared with colormap strips and data marks):
 * - one content box: the track box is inset by {@link SLIDER_THUMB_INSET_PX}
 *   on each side, so a thumb at either end stays inside the control, and
 *   value -> x is `rulerFraction` over that box;
 * - one domain transform ({@link makeRuler}). The ruler spans `domain` when
 *   given, else [min, max]; it is frozen while the control is in use (pointer
 *   held or a thumb focused) and can only grow, so a moving window never
 *   ratchets the ruler inwards under the pointer. `min`/`max` are the VALUE
 *   clamp (Home/End go there). Callers whose clamp follows a live window
 *   should pass a stable `domain` (data ∪ default window) so the ruler does
 *   not shrink between interactions either;
 * - the track's own ends are the domain (no end caps). The data range is two
 *   short marks BELOW the track (outside the 3px track and the thumb), so
 *   they read on every fill and never hide under a thumb.
 *
 * Fill = what is shown: a single slider fills from `min`; an intensity range
 * (`mode="shown"`) fills between thumbs; a threshold (`mode="hidden"`) fills
 * the KEPT segments lightly and draws the removed interval as the colorbar's
 * hatched cut-out.
 *
 * Thumbs are `role="slider"` elements with explicit key handling (the
 * equivalent of `step="any"`: values are never snapped to a native grid).
 * Arrows move one `step`, PageUp/PageDown ten, Home/End the clamp ends.
 * Pointer input snaps to `snap` (anchored at the ruler start) when given.
 * Hover grows the thumb (6×12 -> 8×14) and lifts the track.
 * Coincident range thumbs (an unset [0, 0] threshold) separate in either
 * direction: the thumb is chosen by the first drag direction.
 *
 * Callbacks: `onValueChange` on every change; `onValueCommit` once per
 * gesture (pointer release, key release, chip commit); `onDragChange` for
 * pointer drags only (feeds `dragSourceStore`; keyboard focus never counts
 * as dragging); `onInteraction` for focus-or-pointer (domain freeze).
 *
 * Accessible name = `label` (range: "<label> low" / "<label> high"). Value
 * text uses the ASCII formatter so assistive tech reads "-2.3";
 * `aria-valuenow` is rounded to the step precision; range thumbs report the
 * other thumb as their bound (APG multi-thumb). Readouts are LTR-isolated so
 * "−4.58 to 6.15" never reorders in an RTL context.
 */

interface SliderCommonProps {
  /** Accessible name. */
  label: string;
  /** Value clamp (and the ruler when no `domain`). */
  min: number;
  max: number;
  /** Ruler extent, independent of the value clamp. */
  domain?: readonly [number, number] | null;
  /** Keyboard step (default: span / 200). */
  step?: number;
  /** Pointer snap grid anchored at the ruler start (e.g. voxel spacing for the rail). */
  snap?: number;
  /** Data range on the ruler, drawn as two short marks below the track. */
  dataRange?: readonly [number, number] | null;
  /** Display formatter for the readout (default `formatLayerValue`). */
  format?: (value: number) => string;
  /** aria-valuetext (default `formatLayerValueAscii`). */
  valueText?: (value: number) => string;
  /** Show the formatted value. */
  showValue?: boolean;
  /** Readout as editable chips (click, type, Enter). Implies `showValue`. */
  editable?: boolean;
  /** `inline`: right of the track. `below`: on its own line (narrow 320px Inspector). */
  valuePlacement?: 'inline' | 'below';
  /** Caption under the track ("|value| ≤ 2.3 hidden"). */
  caption?: React.ReactNode;
  /**
   * Fixed width of the static readout (CSS length, e.g. "6ch"), right-aligned,
   * so stacked sliders in one form end their tracks at the same x whatever
   * their value text ("2.5 px" vs "100%").
   */
  valueWidth?: string;
  disabled?: boolean;
  /** `rail`: the viewport slice scrubber (canvas ground, no fill, grows on hover). */
  variant?: 'default' | 'rail';
  /** Interaction (focus or pointer) start/end, with the domain in force at that moment. */
  onInteraction?: (active: boolean, domain: readonly [number, number]) => void;
  /** Pointer drag start/end only (never keyboard focus): for `dragSourceStore`. */
  onDragChange?: (dragging: boolean) => void;
  /** Freeze the domain while in use (default true). */
  freezeDomain?: boolean;
  className?: string;
  id?: string;
  'aria-describedby'?: string;
  /**
   * Names the slider's root as a `group` (FieldRow passes its label's id: a
   * `<div>` cannot be named by `<label for>`). Thumbs keep their own names.
   */
  'aria-labelledby'?: string;
}

export interface SliderProps extends SliderCommonProps {
  value: number;
  onValueChange: (value: number) => void;
  /** Final value of a gesture (pointer up, key up, chip commit). */
  onValueCommit?: (value: number) => void;
  /** Fill from `min` to the thumb (default true; the rail never fills). */
  fill?: boolean;
}

export interface RangeSliderProps extends SliderCommonProps {
  value: readonly [number, number];
  onValueChange: (value: [number, number]) => void;
  onValueCommit?: (value: [number, number]) => void;
  /**
   * `shown`: the interval between thumbs is what is displayed (intensity
   * window), filled. `hidden`: it is what a threshold removes, drawn as the
   * colorbar's hatched cut-out, with the kept segments lightly filled.
   */
  mode?: 'shown' | 'hidden';
  /**
   * `mode="hidden"` only: whether the threshold currently hides anything.
   * When false the hatched cut-out is not drawn and the whole track reads as
   * kept. Pass the colorbar's rule (`isThresholdActive(value)`) so the
   * backend's "no threshold" sentinels ([0, 0], [0, 100]) draw no hatch.
   * Default: active whenever high > low.
   */
  hiddenActive?: boolean;
  thumbLabels?: readonly [string, string];
}

const rootVariants = cva('group relative flex min-w-0 select-none', {
  variants: {
    variant: {
      default: '',
      rail: 'bg-bf-bg-canvas px-2',
    },
    placement: {
      inline: 'flex-row flex-wrap items-center gap-x-2',
      below: 'flex-col items-stretch',
    },
    disabled: { true: 'cursor-not-allowed opacity-50', false: '' },
  },
  defaultVariants: { variant: 'default', placement: 'inline', disabled: false },
});

const trackVariants = cva(
  'pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-bf-xs forced-colors:bg-[GrayText] forced-colors:[forced-color-adjust:none]',
  {
    variants: {
      variant: {
        default:
          'h-[3px] bg-bf-border-strong transition-colors group-hover:bg-[#75777b] group-data-[dragging=true]:bg-[#75777b] group-data-[force-hover]:bg-[#75777b]',
        // Mid neutral on black (≈3:1) so the rail's extent reads at rest.
        rail: 'h-[3px] bg-[color-mix(in_srgb,var(--bf-text-muted)_56%,var(--bf-bg-canvas))] transition-[height] group-hover:h-1.5 group-focus-within:h-1.5 group-data-[dragging=true]:h-1.5 group-data-[force-hover]:h-1.5',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

const thumbVariants = cva(
  [
    'absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-bf-xs bg-primary shadow-[0_0_0_1px_var(--bf-bg-canvas)] outline-0',
    'forced-colors:bg-[ButtonText] forced-colors:[forced-color-adjust:none]',
    'focus-visible:rounded-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--bf-border-focus)]',
    'data-[force-focus]:rounded-none data-[force-focus]:outline data-[force-focus]:outline-2 data-[force-focus]:outline-offset-1 data-[force-focus]:outline-[var(--bf-border-focus)]',
  ],
  {
    variants: {
      variant: {
        default:
          'h-3 w-1.5 transition-[width,height] hover:bg-foreground group-hover:h-3.5 group-hover:w-2 group-data-[dragging=true]:h-3.5 group-data-[dragging=true]:w-2 group-data-[dragging=true]:bg-foreground group-data-[force-hover]:h-3.5 group-data-[force-hover]:w-2 group-data-[force-hover]:bg-foreground',
        rail: 'h-2.5 w-1 transition-[width,height] group-hover:h-3.5 group-hover:w-1.5 group-focus-within:h-3.5 group-focus-within:w-1.5 group-data-[dragging=true]:h-3.5 group-data-[dragging=true]:w-1.5 group-data-[force-hover]:h-3.5 group-data-[force-hover]:w-1.5',
      },
      disabled: { true: 'cursor-not-allowed', false: 'cursor-grab' },
    },
    defaultVariants: { variant: 'default', disabled: false },
  },
);

interface CoreProps extends SliderCommonProps {
  values: readonly number[];
  onValues: (values: number[]) => void;
  onCommit?: (values: number[]) => void;
  thumbLabels: readonly string[];
  band: 'fill-from-min' | 'shown' | 'hidden' | 'none';
  /** `band="hidden"`: false draws no cut-out (default: high > low). */
  hiddenActive?: boolean;
  /** Static readout text (null: none). Ignored when `editable`. */
  valueDisplay: string | null;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** Pixels around coincident thumbs that defer the thumb choice to the drag direction. */
const COINCIDENT_GRAB_PX = 6;

const KEY_DELTAS: Record<string, number> = {
  ArrowRight: 1,
  ArrowUp: 1,
  ArrowLeft: -1,
  ArrowDown: -1,
  PageUp: 10,
  PageDown: -10,
};

const SliderCore = forwardRef<HTMLDivElement, CoreProps>(function SliderCore(
  {
    label,
    min,
    max,
    domain,
    step,
    snap,
    dataRange,
    format = formatLayerValue,
    valueText = formatLayerValueAscii,
    editable = false,
    valuePlacement = 'inline',
    caption,
    disabled = false,
    variant = 'default',
    onInteraction,
    onDragChange,
    freezeDomain = true,
    className,
    id,
    'aria-describedby': describedBy,
    'aria-labelledby': labelledBy,
    values,
    onValues,
    onCommit,
    thumbLabels,
    band,
    hiddenActive,
    valueDisplay,
    valueWidth,
  },
  ref,
) {
  const [frozen, setFrozen] = useState<[number, number] | null>(null);
  const [dragging, setDragging] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const thumbRefs = useRef<Array<HTMLDivElement | null>>([]);
  /** Thumb being dragged; 'pending' while coincident thumbs wait for a direction. */
  const dragThumb = useRef<number | 'pending' | null>(null);
  const focusedCount = useRef(0);
  const active = useRef(false);
  /** Values emitted during the current gesture (null: nothing changed yet). */
  const gesture = useRef<number[] | null>(null);

  const base: [number, number] = domain ? [domain[0], domain[1]] : [min, max];
  const [lo, hi] = freezeDomain && frozen ? rulerDomain(base, frozen) : base;
  const ruler = makeRuler(lo, hi);
  // Value clamp: [min, max] with an explicit domain; otherwise the ruler (legacy).
  const [clampLo, clampHi] = domain ? [min, max] : [lo, hi];
  const keyStep = step && step > 0 ? step : hi > lo ? (hi - lo) / 200 : 0.01;

  // Latest values for the interaction bookkeeping (pointer handlers outlive renders).
  const latest = useRef({ lo, hi, onInteraction, onDragChange, values });
  useEffect(() => {
    latest.current = { lo, hi, onInteraction, onDragChange, values };
  });

  const syncActive = () => {
    const next = dragThumb.current !== null || focusedCount.current > 0;
    if (next === active.current) return;
    active.current = next;
    const d: [number, number] = [latest.current.lo, latest.current.hi];
    setFrozen(next ? d : null);
    latest.current.onInteraction?.(next, d);
  };
  useEffect(
    () => () => {
      if (active.current)
        latest.current.onInteraction?.(false, [latest.current.lo, latest.current.hi]);
      if (dragThumb.current !== null) latest.current.onDragChange?.(false);
    },
    [],
  );

  const emit = (out: number[]) => {
    gesture.current = out;
    onValues(out);
  };
  const commitGesture = () => {
    if (gesture.current) onCommit?.(gesture.current);
    gesture.current = null;
  };

  const setThumb = (index: number, raw: number) => {
    let next = clamp(raw, clampLo, clampHi);
    if (values.length === 2) {
      next = index === 0 ? Math.min(next, values[1]) : Math.max(next, values[0]);
    }
    if (Object.is(next, values[index])) return;
    const out = [...values];
    out[index] = next;
    emit(out);
  };

  const onKeyDown = (index: number) => (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const current = values[index];
    let next: number | null = null;
    if (e.key === 'Home') next = clampLo;
    else if (e.key === 'End') next = clampHi;
    else if (e.key in KEY_DELTAS) next = current + KEY_DELTAS[e.key] * keyStep;
    if (next === null) return;
    e.preventDefault();
    setThumb(index, next);
  };
  const onKeyUp = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Home' || e.key === 'End' || e.key in KEY_DELTAS) commitGesture();
  };

  const fractionAt = (clientX: number) => {
    const rect = boxRef.current?.getBoundingClientRect();
    return rect && rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
  };
  const valueAt = (clientX: number) => {
    const raw = ruler.fromFraction(fractionAt(clientX));
    if (!(snap && snap > 0)) return raw;
    // Snapped values carry the grid's precision, not float noise
    // (0.07 not 0.07000000000000001; 2.5 not 2.4999999999999996).
    const snapped = lo + Math.round((raw - lo) / snap) * snap;
    return clamp(snapToPrecision(snapped, snap, lo), lo, hi);
  };

  const startDrag = (index: number) => {
    dragThumb.current = index;
    thumbRefs.current[index]?.focus({ preventScroll: true });
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    const v = valueAt(e.clientX);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragging(true);
    onDragChange?.(true);
    gesture.current = null;
    if (values.length === 2) {
      const [a, b] = values;
      const rect = boxRef.current?.getBoundingClientRect();
      const px = rect
        ? Math.abs(e.clientX - (rect.left + ruler.toFraction(a) * rect.width))
        : Infinity;
      if (a === b && px <= COINCIDENT_GRAB_PX) {
        // Coincident thumbs: wait for the drag direction to pick one.
        dragThumb.current = 'pending';
        thumbRefs.current[1]?.focus({ preventScroll: true });
        syncActive();
        return;
      }
      const index = v <= a ? 0 : v >= b ? 1 : Math.abs(v - a) <= Math.abs(v - b) ? 0 : 1;
      startDrag(index);
      syncActive();
      setThumb(index, v);
      return;
    }
    startDrag(0);
    syncActive();
    setThumb(0, v);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragThumb.current === null) return;
    const v = valueAt(e.clientX);
    if (dragThumb.current === 'pending') {
      const a = values[0];
      if (v === a) return;
      startDrag(v > a ? 1 : 0);
    }
    setThumb(dragThumb.current as number, v);
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragThumb.current === null) return;
    dragThumb.current = null;
    setDragging(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    onDragChange?.(false);
    commitGesture();
    syncActive();
  };

  const pct = (v: number) => `${ruler.toFraction(v) * 100}%`;
  const bandStyle = (a: number, b: number): React.CSSProperties => ({
    left: pct(Math.min(a, b)),
    width: `${Math.max(0, ruler.toFraction(Math.max(a, b)) - ruler.toFraction(Math.min(a, b))) * 100}%`,
  });
  const fillClass =
    'pointer-events-none absolute top-1/2 h-[3px] -translate-y-1/2 rounded-bf-xs forced-colors:bg-[Highlight] forced-colors:[forced-color-adjust:none]';
  const ariaEnds = [clampLo, clampHi];
  const cutOut = band === 'hidden' && (hiddenActive ?? true) && values[1] > values[0];

  const track = (
    <div
      className={cn(
        'relative h-6 min-w-0 flex-1 touch-none',
        // Column layout: flex-1 (basis 0) would collapse the 24px strip to
        // the track, pulling the data marks up onto it. Keep it 24px.
        valuePlacement === 'below' && 'w-full flex-none',
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div
        ref={boxRef}
        data-slider-box
        className="absolute inset-y-0"
        style={{ left: SLIDER_THUMB_INSET_PX, right: SLIDER_THUMB_INSET_PX }}
      >
        <div aria-hidden className={trackVariants({ variant })} />
        {band === 'fill-from-min' && variant !== 'rail' ? (
          <div
            aria-hidden
            data-testid="slider-fill"
            className={cn(fillClass, 'bg-primary/60')}
            style={bandStyle(clampLo, values[0])}
          />
        ) : null}
        {band === 'shown' ? (
          <div
            aria-hidden
            data-testid="slider-fill"
            className={cn(fillClass, 'bg-primary/60')}
            style={bandStyle(values[0], values[1])}
          />
        ) : null}
        {band === 'hidden' && !cutOut ? (
          // Nothing hidden: the whole ruler is kept.
          <div
            aria-hidden
            data-testid="slider-kept"
            className={cn(fillClass, 'bg-primary/35')}
            style={bandStyle(lo, hi)}
          />
        ) : null}
        {band === 'hidden' && cutOut ? (
          <>
            {/* Kept segments: lightly filled ("fill = what is shown"). */}
            <div
              aria-hidden
              data-testid="slider-kept"
              className={cn(fillClass, 'bg-primary/35')}
              style={bandStyle(lo, values[0])}
            />
            <div
              aria-hidden
              data-testid="slider-kept"
              className={cn(fillClass, 'bg-primary/35')}
              style={bandStyle(values[1], hi)}
            />
          </>
        ) : null}
        {band === 'hidden' && cutOut ? (
          <div
            aria-hidden
            data-testid="slider-hidden-band"
            className="pointer-events-none absolute top-1/2 h-[7px] -translate-y-1/2 outline outline-1 outline-[var(--bf-border-strong)] forced-colors:[forced-color-adjust:none]"
            style={{ ...bandStyle(values[0], values[1]), background: HIDDEN_BAND_BACKGROUND }}
          />
        ) : null}
        {dataRange
          ? dataRange.map((v, i) => {
              if (!Number.isFinite(v)) return null;
              // A mark on a domain end would sit under the track's own end and
              // read as an end cap: nudge it 3px inward (the tooltip still
              // names the exact value).
              const f = ruler.toFraction(v);
              const atEnd = f <= 0.002 ? 'min' : f >= 0.998 ? 'max' : undefined;
              return (
                // A 7px hover target holding a 1×4px mark 2px below the thumb
                // (bottom of the 24px strip). Offset by a whole 3px (not
                // -50%) so a 1px mark is not split across two half pixels.
                <div
                  key={i}
                  data-testid="slider-data-tick"
                  data-at-end={atEnd}
                  title={`data ${i === 0 ? 'min' : 'max'} ${format(v)}`}
                  className="absolute bottom-0 -ml-[3px] flex h-[5px] w-[7px] justify-center"
                  style={{ left: pct(v) }}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'mt-px block h-1 w-px bg-bf-text-muted forced-colors:bg-[CanvasText] forced-colors:[forced-color-adjust:none]',
                      atEnd === 'min' && 'translate-x-[3px]',
                      atEnd === 'max' && '-translate-x-[3px]',
                    )}
                  />
                </div>
              );
            })
          : null}
        {values.map((v, i) => {
          // APG multi-thumb: each range thumb is bounded by the other.
          const vMin = values.length === 2 && i === 1 ? values[0] : clampLo;
          const vMax = values.length === 2 && i === 0 ? values[1] : clampHi;
          return (
            <div
              key={i}
              ref={(el) => {
                thumbRefs.current[i] = el;
              }}
              role="slider"
              tabIndex={disabled ? -1 : 0}
              aria-label={thumbLabels[i] ?? label}
              aria-valuemin={roundForAria(vMin, keyStep, ariaEnds)}
              aria-valuemax={roundForAria(vMax, keyStep, ariaEnds)}
              aria-valuenow={roundForAria(v, keyStep, ariaEnds)}
              aria-valuetext={valueText(v)}
              aria-orientation="horizontal"
              aria-disabled={disabled || undefined}
              aria-describedby={describedBy}
              onKeyDown={onKeyDown(i)}
              onKeyUp={onKeyUp}
              onFocus={() => {
                focusedCount.current += 1;
                syncActive();
              }}
              onBlur={() => {
                focusedCount.current = Math.max(0, focusedCount.current - 1);
                commitGesture();
                syncActive();
              }}
              className={thumbVariants({ variant, disabled })}
              style={{ left: pct(v) }}
            />
          );
        })}
      </div>
    </div>
  );

  const commitChip = (index: number) => (next: number) => {
    let n = next;
    if (values.length === 2) n = index === 0 ? Math.min(n, values[1]) : Math.max(n, values[0]);
    const out = [...values];
    out[index] = n;
    onValues(out);
    onCommit?.(out);
  };

  let readout: React.ReactNode = null;
  if (editable) {
    const chips = values.map((v, i) => (
      <ValueChip
        key={i}
        value={v}
        label={thumbLabels[i] ?? label}
        format={format}
        min={clampLo}
        max={clampHi}
        disabled={disabled}
        align={i === 1 ? 'end' : 'start'}
        onCommit={commitChip(i)}
      />
    ));
    readout =
      values.length === 2 ? (
        <span
          dir="ltr"
          className={cn(
            'flex shrink-0 items-center gap-1 text-bf-xs text-muted-foreground [unicode-bidi:isolate]',
            valuePlacement === 'below' && 'w-full justify-between',
          )}
        >
          {chips[0]}
          <span aria-hidden>to</span>
          {chips[1]}
        </span>
      ) : (
        <span dir="ltr" className="flex shrink-0 [unicode-bidi:isolate]">
          {chips[0]}
        </span>
      );
  } else if (valueDisplay !== null) {
    readout = (
      <span
        dir="ltr"
        className={cn(
          'shrink-0 whitespace-nowrap font-mono text-bf-xs tabular-nums text-muted-foreground [unicode-bidi:isolate]',
          valueWidth && 'text-right',
        )}
        style={valueWidth ? { width: valueWidth } : undefined}
        aria-hidden
      >
        {valueDisplay}
      </span>
    );
  }

  return (
    <div
      ref={ref}
      id={id}
      role={labelledBy ? 'group' : undefined}
      aria-labelledby={labelledBy}
      dir="ltr"
      className={cn(rootVariants({ variant, disabled, placement: valuePlacement }), className)}
      data-dragging={dragging ? 'true' : undefined}
      data-disabled={disabled ? '' : undefined}
    >
      {track}
      {readout}
      {caption ? (
        <div className="w-full basis-full text-bf-xs text-muted-foreground">{caption}</div>
      ) : null}
    </div>
  );
});

/** Single-value slider. */
export const Slider = forwardRef<HTMLDivElement, SliderProps>(function Slider(
  {
    value,
    onValueChange,
    onValueCommit,
    fill = true,
    format = formatLayerValue,
    showValue = false,
    ...rest
  },
  ref,
) {
  return (
    <SliderCore
      ref={ref}
      {...rest}
      format={format}
      values={[value]}
      onValues={(v) => onValueChange(v[0])}
      onCommit={onValueCommit ? (v) => onValueCommit(v[0]) : undefined}
      thumbLabels={[rest.label]}
      band={fill && rest.variant !== 'rail' ? 'fill-from-min' : 'none'}
      valueDisplay={showValue ? format(value) : null}
    />
  );
});

/** Two-thumb range slider (low ≤ high). */
export const RangeSlider = forwardRef<HTMLDivElement, RangeSliderProps>(function RangeSlider(
  {
    value,
    onValueChange,
    onValueCommit,
    mode = 'shown',
    hiddenActive,
    thumbLabels,
    format = formatLayerValue,
    showValue = false,
    ...rest
  },
  ref,
) {
  return (
    <SliderCore
      ref={ref}
      {...rest}
      format={format}
      values={[value[0], value[1]]}
      onValues={(v) => onValueChange([v[0], v[1]])}
      onCommit={onValueCommit ? (v) => onValueCommit([v[0], v[1]]) : undefined}
      thumbLabels={thumbLabels ?? [`${rest.label} low`, `${rest.label} high`]}
      band={mode}
      hiddenActive={hiddenActive}
      valueDisplay={showValue ? formatRange(value[0], value[1], format) : null}
    />
  );
});

// FieldRow: the root is a <div>, so the row names it with aria-labelledby.
(Slider as unknown as Record<string, unknown>)[NON_LABELABLE] = true;
(RangeSlider as unknown as Record<string, unknown>)[NON_LABELABLE] = true;
