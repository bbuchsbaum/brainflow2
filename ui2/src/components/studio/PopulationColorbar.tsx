import { HIDDEN_BAND_BACKGROUND } from '@/components/views/viewportFrame';
import {
  POPULATION_HIDDEN_FRACTION,
  populationColorbarGradient,
} from '@/services/studio/PopulationSliceService';
import type { ScaleClipping } from '@/services/studio/studioMapDisplay';
import { formatLayerValue } from '@/utils/valueFormat';

const BAR_W = 8;
const MARK_W = 3;
const LABEL_GAP = 4;
const LABEL_H = 10;
const MIN_BAR_H = 40;
const MAX_BAR_H = 112;
const CHAR_W = 6.2; // Plex Mono at 10px, approx.
/** Same halo as the viewer colorbar: legible on any ground, no box. */
const TEXT_HALO = '0 0 3px rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.5)';

/**
 * Compact colourbar for a population map, in the viewer colorbar's form
 * (an upright 8 px bar, window ends and 0 as ticks, the hidden band hatched),
 * drawn from the renderer's own ramp stops (`populationColorbarGradient`).
 * Signed maps run −limit to +limit; nonnegative ones 0 to limit.
 */
export function PopulationColorbar({
  limit,
  band,
  diverging,
  paneHeight,
  label,
  format = formatLayerValue,
}: {
  limit: number;
  /** Values with |v| below this are transparent (`populationHiddenBand`). */
  band: number;
  diverging: boolean;
  paneHeight: number;
  /** What the bar shows ("Mean", "Actual observation"), for its accessible name. */
  label: string;
  /** Tick text (the sign share reads 0 % / 50 % / 100 %). */
  format?: (value: number) => string;
}) {
  const barH = Math.min(MAX_BAR_H, Math.floor(paneHeight * 0.4));
  if (!(limit > 0) || !Number.isFinite(limit) || barH < MIN_BAR_H) return null;
  const bandFraction = Math.min(1, Math.max(0, band / limit));
  const ticks = diverging
    ? [
        { value: limit, f: 1 },
        { value: 0, f: 0.5 },
        { value: -limit, f: 0 },
      ]
    : [
        { value: limit, f: 1 },
        { value: 0, f: 0 },
      ];
  const bandBottom = diverging ? 0.5 - bandFraction / 2 : 0;
  const bandHeight = bandFraction;
  const labelChars = Math.max(...ticks.map((tick) => format(tick.value).length));
  const width = BAR_W + MARK_W + LABEL_GAP + Math.ceil(labelChars * CHAR_W);
  const range = diverging ? `${format(-limit)} to ${format(limit)}` : `${format(0)} to ${format(limit)}`;
  return (
    <div
      role="img"
      aria-label={`Colorbar for ${label}: ${diverging ? 'light blue, dark at zero, yellow' : 'gold'}, ${range}${
        band > 0 ? `, |value| below ${formatLayerValue(band)} hidden` : ''
      }`}
      data-testid="population-colorbar"
      data-diverging={diverging ? 'true' : 'false'}
      className="pointer-events-none absolute right-2 top-2 z-10 select-none font-mono text-bf-2xs tabular-nums text-bf-text-secondary"
      style={{ textShadow: TEXT_HALO, width, height: barH }}
    >
      <div
        data-testid="population-colorbar-bar"
        className="absolute outline outline-1 outline-[var(--bf-border)] [forced-color-adjust:none]"
        style={{ left: 0, top: 0, width: BAR_W, height: barH }}
      >
        {bandHeight > 0 && (
          <div
            aria-hidden
            className="absolute inset-x-0"
            style={{
              bottom: `${bandBottom * 100}%`,
              height: `${bandHeight * 100}%`,
              background: HIDDEN_BAND_BACKGROUND,
            }}
          />
        )}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ background: populationColorbarGradient(diverging, bandFraction) }}
        />
      </div>
      {ticks.map((tick) => {
        const y = (1 - tick.f) * barH;
        return (
          <div key={tick.f} aria-hidden>
            <span
              className="absolute h-px bg-bf-text-secondary"
              style={{ left: BAR_W, width: MARK_W, top: Math.round(y - 0.5) }}
            />
            <span
              className="absolute whitespace-nowrap leading-none"
              style={{
                left: BAR_W + MARK_W + LABEL_GAP,
                top: Math.max(0, Math.min(barH - LABEL_H, y - LABEL_H / 2)),
                height: LABEL_H,
              }}
            >
              {format(tick.value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** "values beyond both ends" for a spoken scale, or nothing. */
function clippingText(clipped: ScaleClipping | null | undefined) {
  if (!clipped || (!clipped.low && !clipped.high)) return '';
  return `; values beyond ${
    clipped.low && clipped.high ? 'both ends' : clipped.low ? 'the lower end' : 'the upper end'
  } drawn at the end colour`;
}

/** A small arrowhead past one end of the bar: the data go further. */
function ClipMark({ side }: { side: 'low' | 'high' }) {
  return (
    <span
      data-testid={`scale-clipped-${side}`}
      className="absolute top-0 block h-0 w-0 border-y-[3px] border-y-transparent"
      style={
        side === 'low'
          ? { left: -6, borderRight: '4px solid var(--bf-text-secondary)' }
          : { right: -6, borderLeft: '4px solid var(--bf-text-secondary)' }
      }
    />
  );
}

/** The compact scale's bar (px): about 160 × 6. */
export const POPULATION_SCALE_STRIP_W = 160;

/**
 * The compact horizontal scale for the maps a view shares (A12): −max, the
 * bar with ticks at −max, 0 and +max and a notch over the hidden band (values
 * there are not drawn), +max, and the unit when known. A picture, not a
 * control: its owner (the footer's colour popover) makes it clickable.
 */
export function PopulationScaleStrip({
  limit,
  unit = null,
  range,
  bandFraction = POPULATION_HIDDEN_FRACTION,
  format = formatLayerValue,
  width = POPULATION_SCALE_STRIP_W,
  clipped = null,
  label = 'Colour scale',
}: {
  /** The symmetric window end; null before any map. */
  limit: number | null;
  unit?: string | null;
  /** Spoken range ("−0.02 to 0.02"). */
  range: string;
  bandFraction?: number;
  format?: (value: number) => string;
  width?: number;
  /** Ends the data run past: marked with an arrowhead beyond the bar. */
  clipped?: ScaleClipping | null;
  /** What the scale is of, for its accessible name. */
  label?: string;
}) {
  const band = Math.min(1, Math.max(0, bandFraction));
  return (
    <>
      <span aria-hidden>{limit === null ? '' : format(-limit)}</span>
      <span
        aria-hidden
        className={`relative block h-3 shrink-0 ${clipped?.low ? 'ml-1.5' : ''} ${clipped?.high ? 'mr-1.5' : ''}`}
        style={{ width }}
      >
        <span
          role="img"
          data-testid="montage-scale-bar"
          aria-label={`${label}, ${range}: light blue below zero, dark near zero, yellow above${
            unit ? `, in ${unit}` : ''
          }${clippingText(clipped)}`}
          className="absolute inset-x-0 top-0 block h-1.5 outline outline-1 outline-[var(--bf-border)] [forced-color-adjust:none]"
          style={{
            // The renderer's own stops; the hidden band left dark.
            backgroundImage: populationColorbarGradient(true, band, 'to right'),
          }}
        />
        {/* Ticks at −max, 0 and +max. */}
        {[0, 0.5, 1].map((f) => (
          <span
            key={f}
            data-scale-tick
            className={`absolute top-1.5 block w-px bg-bf-text-muted ${f === 0.5 ? 'h-1.5' : 'h-1'}`}
            style={{ left: `calc(${f * 100}% - ${f * 1}px)` }}
          />
        ))}
        {/* The notch: values with |v| below this band are not drawn. */}
        <span
          data-testid="montage-scale-notch"
          className="absolute top-1.5 block h-0.5 border-x border-b border-bf-text-muted"
          style={{ left: `${(0.5 - band / 2) * 100}%`, width: `${band * 100}%` }}
        />
        {clipped?.low ? <ClipMark side="low" /> : null}
        {clipped?.high ? <ClipMark side="high" /> : null}
      </span>
      <span aria-hidden>{limit === null ? '' : format(limit)}</span>
      {unit ? (
        <span aria-hidden className="font-sans text-bf-text-muted">
          {unit}
        </span>
      ) : null}
    </>
  );
}
