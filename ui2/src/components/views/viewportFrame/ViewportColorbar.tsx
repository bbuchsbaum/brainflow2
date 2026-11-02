import { StatSymbol } from '@/components/ui/StatSymbol';
import { statisticLongName, statisticVariable } from '@/utils/statistic';
import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { ThresholdText } from '@/components/ui/ThresholdText';
import { HIDDEN_BAND_BACKGROUND, spreadLabelCenters, type ColorbarTick } from './frameFormat';
import { formatRange } from '@/utils/valueFormat';
import { asciiCopyHandler } from '@/utils/numericInput';
import { holdColorbarSlot, placeColorbarBlock, type ColorbarSlot } from './colorbarPlacement';
import {
  BAR_W,
  CAP_H,
  CAPTION_GAP,
  CARET_W,
  LABEL_GAP,
  LABEL_H,
  LINE_H,
  MARK_W,
  MAX_BAR_H,
  MIN_BAR_H,
  NAME_GAP,
  VALUE_GAP,
  measureColorbar,
  type ColorbarLayer,
} from './colorbarMeasure';

export type { ColorbarLayer } from './colorbarMeasure';

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
  /** Distance of the top orientation letter from the top (a header row above it). */
  topLetterInset?: number;
  /** Centre line of the side orientation letters, when not the canvas area's middle. */
  sideLetterY?: number;
  /** False for a column of its own with no letters, header or badge (Mosaic). */
  paneChrome?: boolean;
  /**
   * The pane is being resized or zoomed: keep the slot and form placed before
   * it started (following the image), and choose again once it is quiet.
   */
  hold?: boolean;
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
/**
 * Below this canvas-area width (or height) the colorbar takes its compact
 * form (the bar and its two window ends): the full block (a 48px bar plus
 * labels and caption, ~50×90px) would sit on the data. It never vanishes in
 * a narrow pane (QA 2026-10-31 N16). Equal to COLORBAR_COMPACT_BELOW.
 */
export const COLORBAR_MIN_WIDTH = 160;
const COLORBAR_TEXT_HALO = '0 0 3px rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.5)';
/**
 * A faint ground behind the caption and footer text only (not a box): over
 * white cortex the halo alone left "|z| ≤ 4.5 hidden" unreadable (v4).
 */
const TEXT_BACKING =
  'rounded-bf-xs bg-[color-mix(in_srgb,var(--bf-bg-canvas)_60%,transparent)] px-0.5 -mx-0.5';

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
 * Placement (colorbarPlacement.ts, `placeColorbarBlock`): outside the
 * volume's on-screen bounds in the largest free margin; else on the image in
 * the corner covering the least of it and never the crosshair, on a scrim.
 * The threshold caption and the value caret stay in the same block. A narrow
 * or short pane, or one whose margins only hold the bar, gets the compact
 * form: the bar and its two window ends.
 */
export function ViewportColorbar({
  layer,
  width,
  height,
  imageRect,
  avoidPoint,
  dataRect = null,
  topReserve = 0,
  topLetterInset = 0,
  sideLetterY,
  paneChrome = true,
  hold = false,
  value = null,
  tag = null,
  corner = null,
  maxWidth = null,
}: ViewportColorbarProps) {
  const {
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
  } = useMemo(() => measureColorbar(layer, { value, tag, maxWidth }), [layer, value, tag, maxWidth]);
  // The slot used last time: kept while it still fits (hysteresis).
  const previousSlot = useRef<ColorbarSlot | null>(null);
  const previousCompact = useRef(false);
  // The last placement made with the full rule (not while holding).
  const settled = useRef<{ slot: ColorbarSlot; barH: number; compact: boolean } | null>(null);

  // ── placement (colorbarPlacement.ts) ──
  let layout: {
    style: CSSProperties;
    barH: number;
    slot: string;
    scrim: boolean;
    compact: boolean;
  } | null = null;
  if (corner === 'top' && !imageRect) {
    // A column of its own: top right, nothing under it.
    const flipTop = Math.max(EDGE, topReserve);
    const barH = Math.min(MAX_BAR_H, Math.floor(height / 2 - 14 - flipTop - chromeH));
    if (barH >= MIN_BAR_H) {
      layout = {
        style: { right: EDGE, top: flipTop },
        barH,
        slot: 'column',
        scrim: false,
        compact: false,
      };
    }
  } else {
    const pane = {
      width,
      height,
      imageRect,
      dataRect,
      avoidPoint,
      topReserve,
      topLetterInset,
      sideLetterY,
      paneChrome,
      previousSlot: previousSlot.current,
      previousCompact: previousCompact.current,
    };
    const held = hold ? settled.current : null;
    const chosen = held
      ? {
          ...holdColorbarSlot({ ...pane, ...(held.compact ? forms.compact : forms.full) }, held),
          compact: held.compact,
        }
      : placeColorbarBlock(pane, forms);
    if (chosen) {
      layout = {
        style: { left: chosen.left, top: chosen.top },
        barH: chosen.barH,
        slot: chosen.slot,
        scrim: chosen.scrim,
        compact: chosen.compact,
      };
    }
  }
  const placedSlot = layout && layout.slot !== 'column' ? (layout.slot as ColorbarSlot) : null;
  const placedCompact = !!layout?.compact;
  const placedBarH = layout?.barH ?? 0;
  useEffect(() => {
    previousSlot.current = placedSlot;
    previousCompact.current = placedCompact;
    if (!hold) settled.current = placedSlot ? { slot: placedSlot, barH: placedBarH, compact: placedCompact } : null;
  }, [placedSlot, placedCompact, placedBarH, hold]);

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
        layout.scrim
          ? ' rounded-bf-xs bg-[color-mix(in_srgb,var(--bf-bg-canvas)_72%,transparent)]'
          : ''
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
            {layer.units && <StatSymbol label={layer.units} className="text-bf-text-secondary" />}
            {layer.units && layer.nameLabel && nameInline && (
              <span className="text-bf-text-muted"> · </span>
            )}
            {layer.nameLabel && nameInline && (
              <span className="text-bf-text-muted">{layer.nameLabel}</span>
            )}
          </span>
        </div>
      )}
      {!compact &&
        nameLines.map((line) => (
          <div
            key={line}
            className="whitespace-nowrap text-left leading-none text-bf-text-muted"
            style={{
              height: LINE_H,
              marginTop: -NAME_GAP + 2,
              marginBottom: NAME_GAP,
              paddingLeft: nameIndent,
            }}
            data-testid="viewport-colorbar-name-line"
          >
            <span className={TEXT_BACKING}>{line}</span>
          </div>
        ))}
      {!compact &&
        tagLines.map((line, i) => (
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
      <div className="relative font-mono tabular-nums" style={{ width: groupW, height: groupH }}>
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
