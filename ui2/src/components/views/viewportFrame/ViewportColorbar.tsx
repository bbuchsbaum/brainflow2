import { StatSymbol } from '@/components/ui/StatSymbol';
import { statisticLongName, statisticVariable } from '@/utils/statistic';
import type { CSSProperties } from 'react';
import { ThresholdText } from '@/components/ui/ThresholdText';
import {
  HIDDEN_BAND_BACKGROUND,
  colorbarTicks,
  spreadLabelCenters,
  wrapNameAtBoundaries,
  colormapVerticalGradient,
  hiddenBand,
  thresholdExpressionParts,
  type ColorbarTick,
} from './frameFormat';
import { formatLayerValue, formatRange } from '@/utils/valueFormat';
import { asciiCopyHandler } from '@/utils/numericInput';
import { placeColorbar } from './colorbarPlacement';

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

export interface ImageRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface ViewportColorbarProps {
  layer: ColorbarLayer;
  /** Canvas-area size in CSS px. */
  width: number;
  height: number;
  /** Drawn image rectangle in canvas-area CSS px (from the viewport placement). */
  imageRect?: ImageRect | null;
  /** Crosshair centre in canvas-area CSS px: never under the block. */
  avoidPoint?: { x: number; y: number } | null;
  /** Where the data is drawn (canvas-area CSS px): an on-image block avoids it. */
  dataRect?: ImageRect | null;
  /** Space kept clear at the top-right when the corner bar flips up (e.g. the layout button). */
  topReserve?: number;
  /** The layer's value at the crosshair: drawn as a caret with its number. */
  value?: number | null;
  /** Muted note on its own line under the caption, e.g. "threshold unlinked" (Compare). */
  tag?: string | null;
  /**
   * A column of its own (Compare's reserved column, no image under it): top
   * right. Ignored when an image rectangle is given (the placement rules
   * then decide; colorbarPlacement.ts).
   */
  corner?: 'top' | null;
  /**
   * Widest the block may be (a reserved column, Compare): the name caption
   * middle-truncates and the footer wraps to fit; the bar group is the floor.
   */
  maxWidth?: number | null;
}

const EDGE = 8; // px from the canvas-area edges
const BAR_W = 8;
const LABEL_GAP = 4;
const MARK_W = 3;
const CARET_W = 5; // caret column (triangle 4px + 1px gap to the bar)
const VALUE_GAP = 2; // value label → caret
const LINE_H = 11; // caption line
const CAPTION_GAP = 6; // bar group bottom → caption (≥4px clear of the lowest label)
const LABEL_H = 10; // tick label box (text-bf-2xs, leading-none)
const CAP_H = 4; // clipped-end swatch outside the bar
const CAP_GAP = 2;
const MIN_BAR_H = 48;
/** The compact form's shortest bar (a narrow or short pane). */
const COMPACT_MIN_BAR_H = 24;
const NAME_GAP = 6; // name caption → bar group (clears the peak value label)
const MAX_BAR_H = 160;
/**
 * Below this canvas-area width the colorbar takes its compact form (the bar
 * and its two window ends): the full block (a 48px bar plus labels and
 * caption, ~50×90px) would sit on the data. It never vanishes in a narrow
 * pane (QA 2026-10-31 N16).
 */
export const COLORBAR_MIN_WIDTH = 160;
const CHAR_W = 6.2; // Plex Mono at 10px, approx.
const NAME_CHAR_W = 5.6; // Plex Sans at 10px, average
const NAME_MAX_CHARS = 28;
const COLORBAR_TEXT_HALO = '0 0 3px rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.5)';
/**
 * A faint ground behind the caption and footer text only (not a box): over
 * white cortex the halo alone left "|z| ≤ 4.5 hidden" unreadable (v4).
 */
const TEXT_BACKING =
  'rounded-bf-xs bg-[color-mix(in_srgb,var(--bf-bg-canvas)_60%,transparent)] px-0.5 -mx-0.5';
/** Caption note for a statistic guessed from the file name. */
const PAD_X = 8; // scrim px-1 both sides
const PAD_Y = 8; // scrim pt-1.5 + pb-0.5

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

/**
 * On-image colorbar: the Inspector strip's gradient (colormapOptions; for
 * fMRI Red-Blue this is the backend LUT exactly: linear blue→white→red)
 * upright with the window min at the bottom; window ends, threshold edges and
 * 0 as ticks (labels right-aligned so decimals line up); the hidden threshold
 * interval drawn as absent (canvas ground, hatched); the wording under the
 * bar, wrapped to the bar group's width. A window end the data runs past
 * while the hidden band covers it gets a small swatch of the end colour
 * outside the bar that carries the "≤"/"≥" label (those values are drawn in
 * that colour; the hatch alone would hide it). The crosshair value is a caret
 * with its number (clamped to the bar).
 *
 * Placement (colorbarPlacement.ts): outside the image in the larger side
 * margin, else the bottom margin; else on the image in the corner covering
 * the least data and never the crosshair, on a scrim. The threshold caption
 * and the value caret stay in the same block. A narrow pane, or one with no
 * room for the whole block, gets the compact form: the bar and its two
 * window ends.
 */
export function ViewportColorbar({
  layer,
  width,
  height,
  imageRect,
  avoidPoint,
  dataRect = null,
  topReserve = 0,
  value = null,
  tag = null,
  corner = null,
  maxWidth = null,
}: ViewportColorbarProps) {
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
    const nameW = Math.min(Math.ceil(Math.min(nameChars, NAME_MAX_CHARS) * NAME_CHAR_W), textBudget);
    const captionW = Math.ceil(Math.max(0, ...lines.map((l) => l.length * CHAR_W)));
    const boxW =
      Math.max(groupW, lines.length ? barLeft + captionW : 0, nameChars ? barLeft + nameW : 0) + PAD_X;
    return { ticks, labelW, valueW, boxW, lines };
  };
  const nominal = measure(MAX_BAR_H);
  // The layer name, never a fragment (v6 native recheck: "z · zmap_sy…"):
  // beside the symbol when the whole caption fits the box, else whole on up
  // to two lines of its own (wrapped at _ - .), else left out (the symbol
  // stays; the tooltip and accessible name carry the full name).
  const nameRoomChars = Math.floor((nominal.boxW - PAD_X - (nominal.valueW + VALUE_GAP + CARET_W)) / NAME_CHAR_W);
  const captionChars = (layer.units ? layer.units.length + 3 : 0) + (layer.nameLabel?.length ?? 0);
  const nameInline = !layer.nameLabel || captionChars <= nameRoomChars;
  const nameLines = nameInline || !layer.nameLabel ? [] : wrapNameAtBoundaries(layer.nameLabel, nameRoomChars, 2);
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

  // ── placement (colorbarPlacement.ts) ──
  let layout: { style: CSSProperties; barH: number; slot: string; scrim: boolean; compact: boolean } | null =
    null;
  if (corner === 'top' && !imageRect) {
    // A column of its own: top right, nothing under it.
    const flipTop = Math.max(EDGE, topReserve);
    const barH = Math.min(MAX_BAR_H, Math.floor(height / 2 - 14 - flipTop - chromeH));
    if (barH >= MIN_BAR_H) {
      layout = { style: { right: EDGE, top: flipTop }, barH, slot: 'column', scrim: false, compact: false };
    }
  } else {
    const place = (compactForm: boolean) =>
      placeColorbar({
        width,
        height,
        imageRect,
        dataRect,
        avoidPoint,
        topReserve,
        chromeH: compactForm ? PAD_Y + capTopH + capBottomH : chromeH,
        boxWidth: (barH) => measure(barH, compactForm).boxW,
        minBarH: compactForm ? COMPACT_MIN_BAR_H : MIN_BAR_H,
        maxBarH: MAX_BAR_H,
      });
    const full = width >= COLORBAR_MIN_WIDTH ? place(false) : null;
    // A narrow pane, or no room for the full block: the compact form, never nothing.
    const chosen = full ?? place(true);
    if (chosen) {
      layout = {
        style: { left: chosen.left, top: chosen.top },
        barH: chosen.barH,
        slot: chosen.slot,
        scrim: chosen.scrim,
        compact: !full,
      };
    }
  }

  if (!cmap || !layout) return null;
  const { barH, compact } = layout;
  const { ticks, labelW, valueW, lines, boxW } = measure(barH, compact);
  const groupH = capTopH + barH + capBottomH;
  const barTop = capTopH;

  // y (px from the group top) of a value / tick; clipped window ends with a
  // cap sit on the cap.
  const capTopY = CAP_H / 2;
  const capBottomY = groupH - CAP_H / 2;
  const yOfFraction = (f: number) => barTop + (1 - f) * barH;
  const yOfTick = (t: ColorbarTick) => {
    if (t.kind === 'window' && t.value === wMax && capTop) return capTopY;
    if (t.kind === 'window' && t.value === wMin && capBottom) return capBottomY;
    return yOfFraction(t.fraction);
  };
  const labelTop = (y: number) => Math.max(0, Math.min(groupH - LABEL_H, y - LABEL_H / 2));
  // Crowded labels move apart (3 px clear); their marks stay put.
  const labelYs = spreadLabelCenters(
    ticks.map(yOfTick),
    LABEL_H + 3,
    LABEL_H / 2,
    groupH - LABEL_H / 2,
  );

  let caretY: number | null = null;
  if (hasValue && !compact) {
    const v = value as number;
    if (v > wMax && capTop) caretY = capTopY;
    else if (v < wMin && capBottom) caretY = capBottomY;
    else {
      const f = wMax > wMin ? Math.max(0, Math.min(1, (v - wMin) / (wMax - wMin))) : 0.5;
      caretY = yOfFraction(f);
    }
  }
  // The value label sits on the caret's side of the bar, opposite the tick
  // labels, so it can never read as (or collide with) a tick: a clipped
  // value (e.g. 6.15 above a window max of 6) keeps its true number beside
  // the caret at the bar end, while the "≥ 6" tick stays on the other side.
  const caretLabelTop = caretY === null ? null : labelTop(caretY);

  // Spoken with the long name ("z score, inferred from file name"), never
  // "z star" (v5 fidelity).
  const spokenUnits = layer.units ? statisticLongName(layer.units) : null;
  const spokenVariable = layer.units ? statisticVariable(layer.units) : null;
  const ariaLabel = [
    `Colorbar for ${layer.name}${tag ? ` (${tag})` : ''}: ${cmap.label}`,
    `${formatRange(wMin, wMax)}${spokenUnits ? ` ${spokenUnits}` : ''}`,
    exprParts
      ? `${
          spokenVariable && spokenVariable !== 'value'
            ? exprParts.join(' ').split(spokenVariable).join(statisticLongName(spokenVariable))
            : exprParts.join(' ')
        } hidden`
      : null,
    valueLabel ? `value at crosshair ${valueLabel}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  // One column order in every view (Orthogonal, Studio, Compare):
  // value label | caret | bar | tick mark | tick labels.
  const colLeft = (col: 'value' | 'caret' | 'bar' | 'mark' | 'label') => {
    const caret = valueW + VALUE_GAP;
    const order = {
      value: 0,
      caret,
      bar: caret + CARET_W,
      mark: caret + CARET_W + BAR_W,
      label: caret + CARET_W + BAR_W + MARK_W + LABEL_GAP,
    };
    return order[col];
  };
  const groupW = valueW + VALUE_GAP + CARET_W + BAR_W + MARK_W + LABEL_GAP + labelW;
  // Caption indent: the bar's left edge. The group sits at the box's left
  // content edge, so a wider caption extends the box to the right of the bar.
  const nameIndent = colLeft('bar');
  const swatch = (where: 'top' | 'bottom') => (
    <div
      aria-hidden
      data-testid={`viewport-colorbar-cap-${where}`}
      // Data colour: forced-colors mode must not strip the gradient.
      className="absolute outline outline-1 outline-[var(--bf-border)] [forced-color-adjust:none]"
      style={{
        left: colLeft('bar'),
        width: BAR_W,
        top: where === 'top' ? 0 : groupH - CAP_H,
        height: CAP_H,
        background: cmap.gradient,
        backgroundSize: `100% ${barH}px`,
        backgroundPosition: where === 'top' ? 'top' : 'bottom',
      }}
    />
  );

  return (
    <div
      data-testid="viewport-colorbar"
      data-placement={layout.slot}
      data-compact={compact || undefined}
      role="img"
      aria-label={ariaLabel}
      // No box: over the image (Compare's corner placement) a scrim read as a
      // grey block behind the value; a text halo, like the orientation
      // letters, keeps the labels legible on any ground.
      // On the image (a corner) the block sits on a scrim so the labels read
      // over white matter; off the image (a margin) the halo is enough.
      className={`pointer-events-none absolute z-10 select-none px-1 pb-0.5 pt-1.5 text-bf-2xs text-bf-text-secondary${
        layout.scrim ? ' rounded-bf-xs bg-[color-mix(in_srgb,var(--bf-bg-canvas)_72%,transparent)]' : ''
      }`}
      style={{ ...layout.style, width: boxW, textShadow: COLORBAR_TEXT_HALO }}
      onCopy={asciiCopyHandler}
    >
      {!compact && (layer.nameLabel || layer.units) && (
        // One-line caption: the statistic symbol (upright text, italic
        // variable), then the muted, middle-truncated layer name.
        <div
          data-testid="viewport-colorbar-name"
          className="truncate whitespace-nowrap text-left leading-none"
          // Left-aligned to the bar (the group is right-aligned in the box).
          style={{ height: LINE_H, marginBottom: NAME_GAP, paddingLeft: nameIndent }}
          title={layer.units ? `${statisticLongName(layer.units)} · ${layer.name}` : layer.name}
        >
          <span className={TEXT_BACKING}>
          {layer.units && (
            <StatSymbol label={layer.units} className="text-bf-text-secondary" />
          )}
          {layer.units && layer.nameLabel && nameInline && <span className="text-bf-text-muted"> · </span>}
          {layer.nameLabel && nameInline && <span className="text-bf-text-muted">{layer.nameLabel}</span>}
          </span>
        </div>
      )}
      {!compact && nameLines.map((line) => (
        <div
          key={line}
          className="whitespace-nowrap text-left leading-none text-bf-text-muted"
          style={{ height: LINE_H, marginTop: -NAME_GAP + 2, marginBottom: NAME_GAP, paddingLeft: nameIndent }}
          data-testid="viewport-colorbar-name-line"
        >
          <span className={TEXT_BACKING}>{line}</span>
        </div>
      ))}
      {!compact && tagLines.map((line, i) => (
        <div
          key={line}
          className="whitespace-nowrap text-left leading-none text-bf-text-muted"
          style={{
            height: LINE_H,
            marginTop: i === 0 ? -NAME_GAP + 2 : 0,
            marginBottom: i === tagLines.length - 1 ? NAME_GAP : 0,
            paddingLeft: nameIndent,
          }}
          data-testid="viewport-colorbar-tag"
        >
          <span className={TEXT_BACKING}>{line}</span>
        </div>
      ))}
      <div
        className="relative font-mono tabular-nums"
        style={{ width: groupW, height: groupH }}
      >
        {capTop && swatch('top')}
        {capBottom && swatch('bottom')}
        <div
          data-testid="viewport-colorbar-bar"
          // Data colour (and its hatched cut-out): kept in forced-colors mode.
          className="absolute outline outline-1 outline-[var(--bf-border)] [forced-color-adjust:none]"
          style={{
            left: colLeft('bar'),
            top: barTop,
            width: BAR_W,
            height: barH,
            background: cmap.gradient,
          }}
        >
          {band && (
            <div
              data-testid="viewport-colorbar-hidden-band"
              aria-hidden
              className="absolute inset-x-0"
              style={{
                bottom: `${band[0] * 100}%`,
                height: `${(band[1] - band[0]) * 100}%`,
                background: HIDDEN_BAND_BACKGROUND,
              }}
            />
          )}
        </div>
        {ticks.map((t, i) => {
          const y = yOfTick(t);
          return (
            <div key={`${t.kind}-${t.value}`} data-tick-kind={t.kind}>
              <span
                aria-hidden
                className="absolute h-px bg-bf-text-secondary"
                style={{ left: colLeft('mark'), width: MARK_W, top: Math.round(y - 0.5) }}
              />
              <span
                className="absolute whitespace-nowrap text-right leading-none"
                style={{
                  left: colLeft('label'),
                  width: labelW,
                  top: labelTop(labelYs[i]),
                  height: LABEL_H,
                }}
              >
                {t.label}
              </span>
            </div>
          );
        })}
        {caretY !== null && valueLabel && (
          <div data-testid="viewport-colorbar-caret" data-value={value ?? undefined}>
            <span
              aria-hidden
              className="absolute h-0 w-0 border-y-[4px] border-y-transparent"
              style={{
                left: colLeft('caret'),
                top: Math.round(caretY - 4),
                borderLeft: '4px solid var(--bf-text-primary)',
              }}
            />
            <span
              aria-hidden
              data-testid="viewport-colorbar-value"
              className="absolute whitespace-nowrap text-right font-medium leading-none text-bf-text-primary"
              style={{
                left: colLeft('value'),
                width: valueW,
                top: caretLabelTop ?? 0,
                height: LABEL_H,
              }}
            >
              {valueLabel}
            </span>
          </div>
        )}
      </div>
      {!compact && lines.length > 0 && (
        <div
          data-testid="viewport-colorbar-caption"
          className="whitespace-nowrap text-left"
          // Under the bar, aligned with it and with the name caption.
          style={{ marginTop: CAPTION_GAP, paddingLeft: nameIndent }}
        >
          {lines.map((line) => (
            <div key={line} className="leading-none" style={{ height: LINE_H }}>
              <span className={TEXT_BACKING}>
                <ThresholdText line={line} variable={statisticVariable(layer.units)} />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
