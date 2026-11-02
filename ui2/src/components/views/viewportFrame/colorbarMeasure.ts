/**
 * The on-image colorbar's measurements (ViewportColorbar.tsx): its layer
 * description, the block's metrics (text widths estimated from the type
 * scale), and its two forms for the placement rule (colorbarPlacement.ts).
 */
import { statisticVariable } from '@/utils/statistic';
import { formatLayerValue } from '@/utils/valueFormat';
import {
  colorbarTicks,
  colormapVerticalGradient,
  hiddenBand,
  thresholdExpressionParts,
  wrapNameAtBoundaries,
} from './frameFormat';
import type { ColorbarForm } from './colorbarPlacement';

export interface ColorbarLayer {
  layerId: string;
  name: string;
  colormap: string;
  intensity: readonly [number, number];
  threshold: readonly [number, number];
  /** Data range of the volume, for the clipping cue at the window ends. */
  dataRange?: { min: number; max: number } | null;
  /** Value units, when the layer declares them. */
  units?: string | null;
  /** The statistic was guessed from the file name: the caption says "(from name)". */
  unitsFromName?: boolean;
  /**
   * Short layer name for the top caption line ("z · zmap_synthetic"); always
   * set by `resolveColorbarLayer`.
   */
  nameLabel?: string | null;
}

export const BAR_W = 8;
export const LABEL_GAP = 4;
export const MARK_W = 3;
export const CARET_W = 5; // caret column (triangle 4px + 1px gap to the bar)
export const VALUE_GAP = 2; // value label → caret
export const LINE_H = 11; // caption line
export const CAPTION_GAP = 6; // bar group bottom → caption (≥4px clear of the lowest label)
export const LABEL_H = 10; // tick label box (text-bf-2xs, leading-none)
export const CAP_H = 4; // clipped-end swatch outside the bar
export const CAP_GAP = 2;
export const MIN_BAR_H = 48;
/** The compact form's shortest bar (a narrow or short pane). */
export const COMPACT_MIN_BAR_H = 24;
export const NAME_GAP = 6; // name caption → bar group (clears the peak value label)
export const MAX_BAR_H = 160;
export const CHAR_W = 6.2; // Plex Mono at 10px, approx.
export const NAME_CHAR_W = 5.6; // Plex Sans at 10px, average
export const NAME_MAX_CHARS = 28;
export const PAD_X = 8; // scrim px-1 both sides
export const PAD_Y = 8; // scrim pt-1.5 + pb-0.5


/**
 * Caption lines, at most two: one line when it fits `maxW`, else the
 * expression and "hidden" (the box widens to the expression rather than
 * breaking it into a third line).
 */
export function colorbarCaptionLines(
  parts: [string, string] | null,
  maxW: number,
  charW = CHAR_W,
): string[] {
  if (!parts) return [];
  const expr = parts.join(' ');
  if (`${expr} hidden`.length * charW <= maxW) return [`${expr} hidden`];
  return [expr, 'hidden'];
}

export interface ColorbarMeasureOptions {
  value?: number | null;
  tag?: string | null;
  maxWidth?: number | null;
}

/**
 * The block's measurements for a layer (text widths are estimated from the
 * type scale): its two forms for the placement rule, and what the render
 * needs. The Orthogonal host choice measures with the same function, so every
 * pane judges its room for the same block.
 */
export function measureColorbar(
  layer: ColorbarLayer,
  { value = null, tag = null, maxWidth = null }: ColorbarMeasureOptions = {},
) {
  // The tag has its own line: it never squeezes the layer name.
  const tagChars = 0;
  // "z*" already marks a guessed statistic; the tooltip spells it out.
  const fromNameChars = 0;
  const cmap = colormapVerticalGradient(layer.colormap);
  const exprParts = thresholdExpressionParts(layer.threshold, statisticVariable(layer.units));
  const [wMin, wMax] = layer.intensity;
  const band = hiddenBand(layer.intensity, layer.threshold);
  const capTop = !!band && band[1] >= 1 && !!layer.dataRange && layer.dataRange.max > wMax;
  const capBottom = !!band && band[0] <= 0 && !!layer.dataRange && layer.dataRange.min < wMin;
  const capTopH = capTop ? CAP_H + CAP_GAP : 0;
  const capBottomH = capBottom ? CAP_H + CAP_GAP : 0;
  const hasValue = value !== null && Number.isFinite(value);
  const valueLabel = hasValue ? formatLayerValue(value as number) : null;

  const measure = (barH: number, compactForm = false) => {
    const allTicks = colorbarTicks(
      layer.intensity,
      layer.threshold,
      Math.max(barH, 1),
      12,
      layer.dataRange,
    );
    // Compact (a narrow pane): the bar with its two window ends only.
    const ticks = compactForm ? allTicks.filter((t) => t.kind === 'window') : allTicks;
    const labelChars = Math.max(1, ...ticks.map((t) => t.label.length));
    const labelW = Math.ceil(labelChars * CHAR_W);
    if (compactForm) {
      const boxW = BAR_W + MARK_W + LABEL_GAP + labelW + PAD_X;
      return { ticks, labelW, valueW: -(VALUE_GAP + CARET_W), boxW, lines: [] as string[] };
    }
    // The value label column (left of the caret) reserves at least 5 chars
    // ("−4.58") so the box does not resize as the crosshair moves.
    const valueW = Math.ceil(Math.max(5, valueLabel?.length ?? 0) * CHAR_W);
    const groupW = valueW + VALUE_GAP + CARET_W + BAR_W + MARK_W + LABEL_GAP + labelW;
    // The footer starts at the bar's left edge (like the name caption) and
    // may widen the box to the right, so "|z| ≤ 3.1 hidden" stays one line.
    const barLeftW = valueW + VALUE_GAP + CARET_W;
    const textBudget = maxWidth ? Math.max(4 * CHAR_W, maxWidth - PAD_X - barLeftW) : Infinity;
    const lines = colorbarCaptionLines(exprParts, Math.min(NAME_MAX_CHARS * CHAR_W, textBudget));
    // The name caption ("z · zmap_synthetic") may widen the box up to
    // NAME_MAX_CHARS; longer names middle-truncate.
    // The name caption starts at the bar's left edge and may widen the box
    // to the right, up to NAME_MAX_CHARS; longer names middle-truncate.
    const nameChars =
      (layer.units ? layer.units.length + 3 + fromNameChars : 0) +
      (layer.nameLabel?.length ?? 0) +
      tagChars;
    const barLeft = valueW + VALUE_GAP + CARET_W;
    const nameW = Math.min(
      Math.ceil(Math.min(nameChars, NAME_MAX_CHARS) * NAME_CHAR_W),
      textBudget,
    );
    const captionW = Math.ceil(Math.max(0, ...lines.map((l) => l.length * CHAR_W)));
    const boxW =
      Math.max(groupW, lines.length ? barLeft + captionW : 0, nameChars ? barLeft + nameW : 0) +
      PAD_X;
    return { ticks, labelW, valueW, boxW, lines };
  };
  const nominal = measure(MAX_BAR_H);
  // The layer name, never a fragment (v6 native recheck: "z · zmap_sy…"):
  // beside the symbol when the whole caption fits the box, else whole on up
  // to two lines of its own (wrapped at _ - .), else left out (the symbol
  // stays; the tooltip and accessible name carry the full name).
  const nameRoomChars = Math.floor(
    (nominal.boxW - PAD_X - (nominal.valueW + VALUE_GAP + CARET_W)) / NAME_CHAR_W,
  );
  const captionChars = (layer.units ? layer.units.length + 3 : 0) + (layer.nameLabel?.length ?? 0);
  const nameInline = !layer.nameLabel || captionChars <= nameRoomChars;
  const nameLines =
    nameInline || !layer.nameLabel ? [] : wrapNameAtBoundaries(layer.nameLabel, nameRoomChars, 2);
  // The tag ("threshold unlinked") wraps at its words the same way.
  const tagLines = !tag
    ? []
    : tag.length <= nameRoomChars
      ? [tag]
      : (() => {
          const wrapped = wrapNameAtBoundaries(tag, nameRoomChars, 2);
          return wrapped.length > 0 ? wrapped : [tag];
        })();
  const chromeH =
    nameLines.length * (LINE_H + 2) +
    capTopH +
    capBottomH +
    (nominal.lines.length ? CAPTION_GAP + nominal.lines.length * LINE_H : 0) +
    PAD_Y +
    (layer.nameLabel || layer.units ? LINE_H + NAME_GAP : 0) +
    tagLines.length * LINE_H;

  const widths = new Map<string, number>();
  const boxWidth = (compactForm: boolean) => (barH: number) => {
    const key = `${compactForm ? 'c' : 'f'}${barH}`;
    let w = widths.get(key);
    if (w === undefined) {
      w = measure(barH, compactForm).boxW;
      widths.set(key, w);
    }
    return w;
  };
  const forms: { full: ColorbarForm; compact: ColorbarForm } = {
    full: { chromeH, boxWidth: boxWidth(false), minBarH: MIN_BAR_H, maxBarH: MAX_BAR_H },
    compact: {
      chromeH: PAD_Y + capTopH + capBottomH,
      boxWidth: boxWidth(true),
      minBarH: COMPACT_MIN_BAR_H,
      maxBarH: MAX_BAR_H,
    },
  };
  return {
    cmap,
    exprParts,
    wMin,
    wMax,
    band,
    capTop,
    capBottom,
    capTopH,
    capBottomH,
    hasValue,
    valueLabel,
    measure,
    nameInline,
    nameLines,
    tagLines,
    chromeH,
    forms,
  };
}

