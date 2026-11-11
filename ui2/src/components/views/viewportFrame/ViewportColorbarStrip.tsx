import { useMemo } from 'react';
import { statisticLongName, statisticVariable } from '@/utils/statistic';
import { formatRange } from '@/utils/valueFormat';
import { asciiCopyHandler } from '@/utils/numericInput';
import { HIDDEN_BAND_BACKGROUND } from './frameFormat';
import { BAR_W, measureColorbar, type ColorbarLayer } from './colorbarMeasure';

/** The strip's bar: its longest and shortest length, and its share of the row. */
export const STRIP_BAR_MAX_W = 72;
export const STRIP_BAR_MIN_W = 24;
const STRIP_BAR_SHARE = 0.16;

interface ViewportColorbarStripProps {
  layer: ColorbarLayer;
  /** Width of the row the strip shares with the slice slider, CSS px. */
  rowWidth: number;
}

/**
 * The colour legend in its compact form, laid along the row under a slice
 * canvas (beside the slice slider): the bar with its two window ends, the
 * hidden threshold interval drawn as absent. Used when the legend may not
 * cover the image and no margin beside it holds the block
 * (colorbarPlacement.ts, slot `below`). The layer, statistic and threshold
 * are in the accessible name and the tooltip; nothing sits on the image.
 */
export function ViewportColorbarStrip({ layer, rowWidth }: ViewportColorbarStripProps) {
  const { cmap, wMin, wMax, band, exprParts, measure } = useMemo(
    () => measureColorbar(layer),
    [layer],
  );
  if (!cmap) return null;
  const ends = measure(STRIP_BAR_MAX_W, true).ticks;
  const low = ends.find((t) => t.value === wMin)?.label ?? String(wMin);
  const high = ends.find((t) => t.value === wMax)?.label ?? String(wMax);
  const barW = Math.round(
    Math.max(STRIP_BAR_MIN_W, Math.min(STRIP_BAR_MAX_W, rowWidth * STRIP_BAR_SHARE)),
  );
  const variable = layer.units ? statisticVariable(layer.units) : null;
  const expression = exprParts
    ? variable && variable !== 'value'
      ? exprParts.join(' ').split(variable).join(statisticLongName(variable))
      : exprParts.join(' ')
    : null;
  const label = [
    `Colorbar for ${layer.name}: ${cmap.label}`,
    `${formatRange(wMin, wMax)}${layer.units ? ` ${statisticLongName(layer.units)}` : ''}`,
    expression ? `${expression} hidden` : null,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <div
      data-testid="viewport-colorbar"
      data-placement="below"
      data-compact
      role="img"
      aria-label={label}
      title={label}
      className="flex h-full min-w-0 shrink-0 select-none items-center gap-1 whitespace-nowrap pl-2 pr-1.5 font-mono text-bf-2xs tabular-nums leading-none text-bf-text-secondary"
      onCopy={asciiCopyHandler}
    >
      <span data-tick-kind="window">{low}</span>
      <span
        data-testid="viewport-colorbar-bar"
        // Data colour (and its hatched cut-out): kept in forced-colors mode.
        className="relative block shrink-0 outline outline-1 outline-[var(--bf-border)] [forced-color-adjust:none]"
        style={{
          width: barW,
          height: BAR_W,
          background: cmap.gradient.replace('to top', 'to right'),
        }}
      >
        {band && (
          <span
            data-testid="viewport-colorbar-hidden-band"
            aria-hidden
            className="absolute inset-y-0 block"
            style={{
              left: `${band[0] * 100}%`,
              width: `${(band[1] - band[0]) * 100}%`,
              background: HIDDEN_BAND_BACKGROUND,
            }}
          />
        )}
      </span>
      <span data-tick-kind="window">{high}</span>
    </div>
  );
}
