import React from 'react';
/**
 * Pure helpers for the `bf` primitives (kept out of the component modules so
 * React Fast Refresh boundaries stay component-only).
 */

/** Ids shared by a tab and its panel. */
export function tabIds(idBase: string, value: string) {
  const safe = value.replace(/[^A-Za-z0-9_-]/g, '_');
  return { tab: `${idBase}-tab-${safe}`, panel: `${idBase}-panel-${safe}` };
}

/** Ids for `aria-describedby` on the row's control. */
export function fieldRowIds(controlId: string) {
  return { hintId: `${controlId}-hint`, errorId: `${controlId}-error` };
}

const UNIT_RE = /^(.*\S)\s(mm|ms|s|Hz|%|voxels|vox|TR)$/;
// A number or a numeric expression: "2.00", "−37.5", "228,483", "≈ 4",
// "2 × 2 × 2", "1.5–3", "0 to 255". Prose before a unit word does not match.
const NUMERIC_RE = /^(?:[≈~<>≤≥±]\s?)?[−+-]?\d[\d,.]*(?:\s?(?:×|x|–|-|\/|to)\s?[−+-]?\d[\d,.]*)*$/;

/**
 * Split "2.00 mm" into ["2.00", "mm"]. Only a numeric value keeps its unit
 * apart: "Brain mask, 228,483 voxels" is prose and stays whole.
 */
export function splitUnit(text: string): [string, string | null] {
  const m = UNIT_RE.exec(text);
  return m && NUMERIC_RE.test(m[1]) ? [m[1], m[2]] : [text, null];
}

/** Half the thumb width: the ruler's content box is inset by this on both sides. */
export const SLIDER_THUMB_INSET_PX = 3;

export interface Ruler {
  min: number;
  max: number;
  /** Value -> fraction of the content box, clamped to [0, 1]. */
  toFraction: (value: number) => number;
  /** Fraction of the content box -> value. */
  fromFraction: (fraction: number) => number;
}

/** The shared domain transform. A degenerate span maps everything to 0. */
export function makeRuler(min: number, max: number): Ruler {
  const span = max - min;
  return {
    min,
    max,
    toFraction: (v) => (span > 0 ? Math.max(0, Math.min(1, (v - min) / span)) : 0),
    fromFraction: (f) => min + span * Math.max(0, Math.min(1, f)),
  };
}

/**
 * Union domain of the given values (e.g. data range and window), optionally
 * widened by a frozen domain so it never shrinks during an interaction.
 */
export function rulerDomain(
  values: readonly number[],
  frozen?: readonly [number, number] | null,
): [number, number] {
  const finite = [...values, ...(frozen ?? [])].filter(Number.isFinite);
  if (finite.length === 0) return [0, 1];
  return [Math.min(...finite), Math.max(...finite)];
}

export type StatusKind =
  | 'success'
  | 'running'
  | 'queued'
  | 'failed'
  | 'cancelled'
  | 'warning'
  | 'neutral';

/** Sentence-case label for an analysis job state. */
export function jobStateLabel(state: string): string {
  switch (state) {
    case 'queued':
      return 'Queued';
    case 'running':
      return 'Running';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return state ? state.charAt(0).toUpperCase() + state.slice(1) : 'Unknown';
  }
}

/** Analysis job state -> pill status. Unknown states read as neutral. */
export function jobStateStatus(state: string): StatusKind {
  switch (state) {
    case 'completed':
      return 'success';
    case 'failed':
      return 'failed';
    case 'running':
      return 'running';
    case 'queued':
      return 'queued';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'neutral';
  }
}


// ── interaction ──────────────────────────────────────────────────────────────

const NESTED_INTERACTIVE =
  'button,a[href],input,select,textarea,summary,[contenteditable="true"],[role=button],[role=checkbox],[role=switch],[role=menuitem],[role=link],[role=slider],[role=textbox],[role=combobox]';

/**
 * True when an event started on an interactive control nested INSIDE `row`
 * (an eye toggle in a layer row): the row must not treat it as its own click.
 */
export function isFromNestedControl(target: EventTarget | null, row: Element): boolean {
  if (!(target instanceof Element)) return false;
  const hit = target.closest(NESTED_INTERACTIVE);
  return hit !== null && hit !== row && row.contains(hit);
}

// ── labelable controls ──────────────────────────────────────────────────────

/** HTML elements a `<label for>` can name. */
const LABELABLE_TAGS = new Set(['button', 'input', 'meter', 'output', 'progress', 'select', 'textarea']);

/** Marker a component sets when its root element cannot be named by `<label for>`. */
export const NON_LABELABLE = 'bfNonLabelable';

/**
 * Whether a FieldRow child can be named by `<label for>`: native labelable
 * tags yes, other tags (div, span) no, components unless they carry the
 * {@link NON_LABELABLE} marker (Slider, RangeSlider, SegmentedControl).
 */
export function isLabelableChild(children: unknown): boolean {
  if (typeof children === 'function' || !React.isValidElement(children)) return true;
  const type = children.type as unknown;
  if (typeof type === 'string') return LABELABLE_TAGS.has(type);
  return !(type && (type as Record<string, unknown>)[NON_LABELABLE] === true);
}

// ── layout widths ────────────────────────────────────────────────────────────

/** Named label-column widths: `narrow` (Inspector, 96px) and `wide` (dialogs, 148px). */
export const LABEL_WIDTH = { narrow: 96, wide: 148 } as const;
export type LabelWidth = keyof typeof LABEL_WIDTH;

// ── numbers ──────────────────────────────────────────────────────────────────

/** Decimal places a number is written with ("0.07" -> 2), capped for float noise. */
export function decimalsOf(value: number): number {
  if (!Number.isFinite(value) || Number.isInteger(value)) return 0;
  const text = String(value);
  const exp = /e-(\d+)$/.exec(text);
  if (exp) return Math.min(12, Number(exp[1]) + (text.split('e')[0].split('.')[1]?.length ?? 0));
  const decimals = text.split('.')[1]?.length ?? 0;
  // Float noise (0.1 + 0.2): fall back to the magnitude of the value plus 3.
  return decimals > 6 ? Math.min(12, Math.max(0, Math.ceil(-Math.log10(Math.abs(value)))) + 3) : decimals;
}

/**
 * `aria-valuenow` without float noise: rounded to the precision of the step,
 * of the domain ends and of the value itself when it is written short
 * ("0.5650000000000001" -> 0.565; "2.3" stays 2.3 on an integer step).
 */
export function roundForAria(value: number, step: number, ends: readonly number[] = []): number {
  if (!Number.isFinite(value)) return value;
  const decimals = Math.min(
    12,
    Math.max(decimalsOf(step), decimalsOf(value), ...ends.map(decimalsOf)),
  );
  const rounded = Number(value.toFixed(decimals));
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * A value on a snap grid, rounded to the grid's decimal precision (and the
 * anchor's), so pointer input never emits float noise.
 */
export function snapToPrecision(value: number, snap: number, anchor = 0): number {
  if (!Number.isFinite(value) || !Number.isFinite(anchor)) return value;
  const round = (v: number, d: number) => {
    const r = Number(v.toFixed(Math.min(12, d)));
    return Object.is(r, -0) ? 0 : r;
  };
  const snapDecimals = decimalsOf(snap);
  // A short-written anchor (0, 0.5, -90): round the whole value.
  const anchorText = String(anchor);
  const anchorDecimals = anchorText.includes('e') ? Infinity : (anchorText.split('.')[1]?.length ?? 0);
  if (anchorDecimals <= 6) return round(value, Math.max(snapDecimals, anchorDecimals));
  // A long anchor (a data minimum): keep it exact, clean only the grid offset.
  return anchor + round(value - anchor, snapDecimals);
}

/** A section/meta string that states a quantity ("91 × 109 × 91", "2.0 s") reads in mono. */
export function isNumericText(text: string): boolean {
  return /\d/.test(text) && /^[\d\s×x.,:;+\-−%()/[\]]+(\s?(mm|ms|s|Hz|%|vox|voxels|TR|MB|GB|KB))?$/.test(text.trim());
}

// ── field wiring ─────────────────────────────────────────────────────────────

/** Accessibility props a labelled row hands to its control. */
export interface FieldControlProps {
  id: string;
  /**
   * Set only for NON-labelable controls (a slider's root `<div>`, a
   * radiogroup): the row label's id, since `<label for>` cannot name them.
   */
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  disabled?: boolean;
}

type AnyProps = Record<string, unknown>;

/** Id a single element child already carries (it then names the control). */
export function childControlId(children: unknown): string | undefined {
  return typeof children !== 'function' && React.isValidElement(children)
    ? ((children.props as AnyProps).id as string | undefined)
    : undefined;
}

/**
 * Hand {@link FieldControlProps} to a row's control: call a render function,
 * or clone them onto a single element child (its own values win; describedby
 * ids are merged).
 */
export function wireFieldControl(
  children: React.ReactNode | ((props: FieldControlProps) => React.ReactNode),
  control: FieldControlProps,
): React.ReactNode {
  if (typeof children === 'function') return children(control);
  if (!React.isValidElement(children)) return children;
  const own = children.props as AnyProps;
  const describedBy = [own['aria-describedby'], control['aria-describedby']]
    .filter(Boolean)
    .join(' ');
  return React.cloneElement(children as React.ReactElement<AnyProps>, {
    id: (own.id as string | undefined) ?? control.id,
    // A control that names itself (aria-label / aria-labelledby) keeps its name.
    ...(control['aria-labelledby'] && !own['aria-label'] && !own['aria-labelledby']
      ? { 'aria-labelledby': control['aria-labelledby'] }
      : {}),
    'aria-describedby': describedBy || undefined,
    'aria-invalid': own['aria-invalid'] ?? control['aria-invalid'],
    disabled: own.disabled ?? control.disabled,
  });
}
