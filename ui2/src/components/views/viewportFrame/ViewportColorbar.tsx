import { StatSymbol } from '@/components/ui/StatSymbol';
import { statisticVariable } from '@/utils/statistic';
import type { CSSProperties } from 'react';
import { ThresholdText } from '@/components/ui/ThresholdText';
import {
  HIDDEN_BAND_BACKGROUND,
  colorbarTicks,
  colormapVerticalGradient,
  hiddenBand,
  thresholdExpressionParts,
  type ColorbarTick,
} from './frameFormat';
import { formatLayerValue, formatRange } from '@/utils/valueFormat';
import { asciiCopyHandler } from '@/utils/numericInput';
import { middleTruncate } from './frameFormat';

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
  /** Crosshair centre in canvas-area CSS px; the corner bar flips up if it would cover it. */
  avoidPoint?: { x: number; y: number } | null;
  /** Space kept clear at the top-right when the corner bar flips up (e.g. the layout button). */
  topReserve?: number;
  /** The layer's value at the crosshair: drawn as a caret with its number. */
  value?: number | null;
  /** Muted note on its own line under the caption, e.g. "threshold unlinked" (Compare). */
  tag?: string | null;
  /** Force the corner placement at the top-right (clear of the image's centre). */
  corner?: 'top' | null;
}

const EDGE = 8; // px from the canvas-area edges
const BESIDE_GAP = 12; // px between the image's right edge and the bar
const LETTER_CLEAR = 24; // right orientation letter (offset 6 + glyph + gap)
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
const NAME_GAP = 6; // name caption → bar group (clears the peak value label)
const MAX_BAR_H = 160;
/**
 * Below this canvas-area width the colorbar is not drawn. It differs from the
 * header's 90px rule on purpose: the bar needs a 48px bar plus labels and
 * caption (~50×90px) beside or in the corner of the image, and in panes
 * narrower than 160px that box would sit on the data. The header is one text
 * line and fits much smaller panes.
 */
export const COLORBAR_MIN_WIDTH = 160;
const CHAR_W = 6.2; // Plex Mono at 10px, approx.
const NAME_CHAR_W = 5.6; // Plex Sans at 10px, average
const NAME_MAX_CHARS = 28;
const COLORBAR_TEXT_HALO = '0 0 3px rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.5)';
/** Caption note for a statistic guessed from the file name. */
const FROM_NAME = ' (from name)'; // widest name caption before it truncates
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
 * Placement: beside the image in the right margin, vertically centred on it,
 * when the margin can hold it (no data, crosshair or letter under it).
 * Otherwise the bottom-right corner below the vertical centre (clear of the
 * right letter), flipping to the top-right when the crosshair centre would
 * fall under it.
 */
export function ViewportColorbar({
  layer,
  width,
  height,
  imageRect,
  avoidPoint,
  topReserve = 0,
  value = null,
  tag = null,
  corner = null,
}: ViewportColorbarProps) {
  // The tag has its own line: it never squeezes the layer name.
  const tagChars = 0;
  const fromNameChars = layer.units && layer.unitsFromName ? FROM_NAME.length : 0;
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

  const measure = (barH: number) => {
    const ticks = colorbarTicks(
      layer.intensity,
      layer.threshold,
      Math.max(barH, 1),
      12,
      layer.dataRange,
    );
    const labelChars = Math.max(1, ...ticks.map((t) => t.label.length));
    const labelW = Math.ceil(labelChars * CHAR_W);
    // The value label column (left of the caret) reserves at least 5 chars
    // ("−4.58") so the box does not resize as the crosshair moves.
    const valueW = Math.ceil(Math.max(5, valueLabel?.length ?? 0) * CHAR_W);
    const groupW = valueW + VALUE_GAP + CARET_W + BAR_W + MARK_W + LABEL_GAP + labelW;
    // The footer starts at the bar's left edge (like the name caption) and
    // may widen the box to the right, so "|z| ≤ 3.1 hidden" stays one line.
    const lines = colorbarCaptionLines(exprParts, NAME_MAX_CHARS * CHAR_W);
    // The name caption ("z · zmap_synthetic") may widen the box up to
    // NAME_MAX_CHARS; longer names middle-truncate.
    // The name caption starts at the bar's left edge and may widen the box
    // to the right, up to NAME_MAX_CHARS; longer names middle-truncate.
    const nameChars =
      (layer.units ? layer.units.length + 3 + fromNameChars : 0) +
      (layer.nameLabel?.length ?? 0) +
      tagChars;
    const barLeft = valueW + VALUE_GAP + CARET_W;
    const nameW = Math.ceil(Math.min(nameChars, NAME_MAX_CHARS) * NAME_CHAR_W);
    const captionW = Math.ceil(Math.max(0, ...lines.map((l) => l.length * CHAR_W)));
    const boxW =
      Math.max(groupW, lines.length ? barLeft + captionW : 0, nameChars ? barLeft + nameW : 0) + PAD_X;
    return { ticks, labelW, valueW, boxW, lines };
  };
  const nominal = measure(MAX_BAR_H);
  const chromeH =
    capTopH +
    capBottomH +
    (nominal.lines.length ? CAPTION_GAP + nominal.lines.length * LINE_H : 0) +
    PAD_Y +
    (layer.nameLabel || layer.units ? LINE_H + NAME_GAP : 0) +
    (tag ? LINE_H : 0);

  // ── beside the image ──
  let layout: { style: CSSProperties; barH: number; beside: boolean } | null = null;
  if (corner !== 'top' && imageRect && imageRect.bottom > imageRect.top) {
    const imgH = imageRect.bottom - imageRect.top;
    const barH = Math.min(MAX_BAR_H, Math.floor(Math.min(imgH * 0.6, height - 2 * EDGE - chromeH)));
    const { boxW } = measure(barH);
    const left = Math.round(imageRect.right + BESIDE_GAP);
    const boxH = barH + chromeH;
    if (barH >= MIN_BAR_H && left + boxW <= width - LETTER_CLEAR) {
      const centred = imageRect.top + (imgH - boxH) / 2;
      const top = Math.round(Math.max(EDGE, Math.min(height - EDGE - boxH, centred)));
      layout = { style: { left, top }, barH, beside: true };
    }
  }

  // ── corner fallback ──
  if (!layout) {
    const flipTop = Math.max(EDGE, topReserve);
    const barBottom = Math.min(MAX_BAR_H, Math.floor(height / 2 - 14 - EDGE - chromeH));
    const barTop = Math.min(MAX_BAR_H, Math.floor(height / 2 - 14 - flipTop - chromeH));
    const margin = 12;
    const covers = (top: number, barH: number) => {
      if (!avoidPoint) return false;
      const { boxW } = measure(barH);
      return (
        avoidPoint.x >= width - EDGE - boxW - margin &&
        avoidPoint.x <= width - EDGE + margin &&
        avoidPoint.y >= top - margin &&
        avoidPoint.y <= top + barH + chromeH + margin
      );
    };
    const placeTop =
      corner === 'top' ||
      (barTop >= MIN_BAR_H &&
      covers(height - EDGE - barBottom - chromeH, barBottom) &&
      !covers(flipTop, barTop));
    layout = placeTop
      ? { style: { right: EDGE, top: flipTop }, barH: barTop, beside: false }
      : { style: { right: EDGE, bottom: EDGE }, barH: barBottom, beside: false };
  }

  const { barH, beside } = layout;
  if (!cmap || barH < MIN_BAR_H || width < COLORBAR_MIN_WIDTH) return null;
  const { ticks, labelW, valueW, lines, boxW } = measure(barH);
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

  let caretY: number | null = null;
  if (hasValue) {
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

  const ariaLabel = [
    `Colorbar for ${layer.name}${tag ? ` (${tag})` : ''}: ${cmap.label}`,
    `${formatRange(wMin, wMax)}${layer.units ? ` ${layer.units}` : ''}`,
    exprParts ? `${exprParts.join(' ')} hidden` : null,
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
      data-placement={beside ? 'beside' : 'corner'}
      role="img"
      aria-label={ariaLabel}
      // No box: over the image (Compare's corner placement) a scrim read as a
      // grey block behind the value; a text halo, like the orientation
      // letters, keeps the labels legible on any ground.
      className="pointer-events-none absolute z-10 select-none px-1 pb-0.5 pt-1.5 text-bf-2xs text-bf-text-secondary"
      style={{ ...layout.style, width: boxW, textShadow: COLORBAR_TEXT_HALO }}
      onCopy={asciiCopyHandler}
    >
      {(layer.nameLabel || layer.units) && (
        // One-line caption: the statistic symbol (upright text, italic
        // variable), then the muted, middle-truncated layer name.
        <div
          data-testid="viewport-colorbar-name"
          className="truncate whitespace-nowrap text-left leading-none"
          // Left-aligned to the bar (the group is right-aligned in the box).
          style={{ height: LINE_H, marginBottom: NAME_GAP, paddingLeft: nameIndent }}
          title={layer.units ? `${layer.units} · ${layer.name}` : layer.name}
        >
          {layer.units && (
            <StatSymbol label={layer.units} className="text-bf-text-secondary" />
          )}
          {layer.units && layer.unitsFromName && (
            <span className="text-bf-text-muted">{FROM_NAME}</span>
          )}
          {layer.units && layer.nameLabel && <span className="text-bf-text-muted"> · </span>}
          {layer.nameLabel && (
            <span className="text-bf-text-muted">
              {middleTruncate(
                layer.nameLabel,
                Math.max(
                  1,
                  Math.floor(
                    (boxW -
                      PAD_X -
                      nameIndent -
                      (tagChars + fromNameChars) * NAME_CHAR_W -
                      (layer.units ? (layer.units.length + 3) * NAME_CHAR_W : 0)) /
                      NAME_CHAR_W,
                  ),
                ),
                7,
              ) ?? layer.nameLabel}
            </span>
          )}
        </div>
      )}
      {tag && (
        <div
          className="truncate whitespace-nowrap text-left leading-none text-bf-text-muted"
          style={{ height: LINE_H, marginTop: -NAME_GAP + 2, marginBottom: NAME_GAP, paddingLeft: nameIndent }}
          data-testid="viewport-colorbar-tag"
        >
          {tag}
        </div>
      )}
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
        {ticks.map((t) => {
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
                  top: labelTop(y),
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
      {lines.length > 0 && (
        <div
          data-testid="viewport-colorbar-caption"
          className="whitespace-nowrap text-left"
          // Under the bar, aligned with it and with the name caption.
          style={{ marginTop: CAPTION_GAP, paddingLeft: nameIndent }}
        >
          {lines.map((line) => (
            <div key={line} className="leading-none" style={{ height: LINE_H }}>
              <ThresholdText line={line} variable={statisticVariable(layer.units)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
