import { HIDDEN_BAND_BACKGROUND, colormapVerticalGradient } from '@/components/views/viewportFrame';
import { formatLayerValue } from '@/utils/valueFormat';

const BAR_W = 8;
const MARK_W = 3;
const LABEL_GAP = 4;
const LABEL_H = 10;
const MIN_BAR_H = 28;
const MAX_BAR_H = 112;
const CHAR_W = 6.2; // Plex Mono at 10px, approx.
/** Same halo as the viewer colorbar: legible on any ground, no box. */
const TEXT_HALO = '0 0 3px rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.5)';

/**
 * Compact colourbar for a Studio Compare pane, in the viewer colorbar's form
 * (an upright 8 px bar, window ends and 0 as ticks, the hidden interval
 * hatched), drawn with the layer's own colormap strip. Sized for small panes:
 * it shows down to a 70 px pane, where the viewer colorbar gives up (QA N10).
 */
export function StudioScaleBar({
  min,
  max,
  hidden = null,
  colormap,
  label,
  paneHeight,
}: {
  min: number;
  max: number;
  /** The hidden value interval (the threshold), if any. */
  hidden?: readonly [number, number] | null;
  colormap: string;
  label: string;
  paneHeight: number;
}) {
  const strip = colormapVerticalGradient(colormap);
  const barH = Math.min(MAX_BAR_H, Math.floor(paneHeight * 0.4));
  if (!strip || !(max > min) || barH < MIN_BAR_H) return null;
  const f = (v: number) => (v - min) / (max - min);
  const ticks = [max, ...(min < 0 && max > 0 ? [0] : []), min];
  const band =
    hidden && hidden[1] > hidden[0]
      ? [Math.max(0, f(hidden[0])), Math.min(1, f(hidden[1]))]
      : null;
  const labelChars = Math.max(...ticks.map((t) => formatLayerValue(t).length));
  const width = BAR_W + MARK_W + LABEL_GAP + Math.ceil(labelChars * CHAR_W);
  return (
    <div
      role="img"
      aria-label={`Colorbar for ${label}: ${strip.label}, ${formatLayerValue(min)} to ${formatLayerValue(max)}${
        band ? `, ${formatLayerValue(hidden![0])} to ${formatLayerValue(hidden![1])} hidden` : ''
      }`}
      data-testid="studio-scale-bar"
      data-colormap={colormap}
      className="pointer-events-none absolute right-2 top-8 z-10 select-none font-mono text-bf-2xs tabular-nums text-bf-text-secondary"
      style={{ textShadow: TEXT_HALO, width, height: barH }}
    >
      <div
        className="absolute outline outline-1 outline-[var(--bf-border)] [forced-color-adjust:none]"
        style={{ left: 0, top: 0, width: BAR_W, height: barH, background: strip.gradient }}
      >
        {band && band[1] > band[0] ? (
          <div
            aria-hidden
            className="absolute inset-x-0"
            style={{
              bottom: `${band[0] * 100}%`,
              height: `${(band[1] - band[0]) * 100}%`,
              background: HIDDEN_BAND_BACKGROUND,
            }}
          />
        ) : null}
      </div>
      {ticks.map((tick) => {
        const y = (1 - f(tick)) * barH;
        return (
          <div key={tick} aria-hidden>
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
              {formatLayerValue(tick)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
