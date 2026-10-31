import { HIDDEN_BAND_BACKGROUND } from '@/components/views/viewportFrame';
import { populationColorbarGradient } from '@/services/studio/PopulationSliceService';
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
}: {
  limit: number;
  /** Values with |v| below this are transparent (`populationHiddenBand`). */
  band: number;
  diverging: boolean;
  paneHeight: number;
  /** What the bar shows ("Mean", "Actual observation"), for its accessible name. */
  label: string;
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
  const labelChars = Math.max(...ticks.map((tick) => formatLayerValue(tick.value).length));
  const width = BAR_W + MARK_W + LABEL_GAP + Math.ceil(labelChars * CHAR_W);
  const range = diverging
    ? `${formatLayerValue(-limit)} to ${formatLayerValue(limit)}`
    : `0 to ${formatLayerValue(limit)}`;
  return (
    <div
      role="img"
      aria-label={`Colorbar for ${label}: ${diverging ? 'blue–white–red' : 'gold'}, ${range}${
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
              {formatLayerValue(tick.value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
