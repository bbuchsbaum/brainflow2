/**
 * A series legend set in the plot frame's top-right corner (round 2 R4), in
 * the strip the plot reserves with `topInset`, so its place does not depend
 * on the toolbar's width. A sibling of the plot box (not inside it), so the
 * image export draws its own legend once.
 */
import { SeriesLegendSwatch } from './encoder/legend';

/** Plot param: the strip above the plot area the legend sits in (px). */
export const FRAME_LEGEND_INSET = 16;

export function PlotFrameLegend({
  entries,
  band = null,
  label = 'Series legend',
}: {
  entries: { label: string; color: string }[];
  /** "band: 95% CI", stated once. */
  band?: string | null;
  label?: string;
}) {
  if (!entries.length) return null;
  return (
    <div
      aria-label={label}
      data-testid="series-legend"
      className="pointer-events-none absolute right-3 top-0.5 flex max-w-[70%] flex-wrap justify-end gap-x-3 text-bf-2xs text-bf-text-secondary"
    >
      {entries.map((e) => (
        <span key={e.label} className="inline-flex items-center gap-1">
          <SeriesLegendSwatch color={e.color} band={!!band} />
          {e.label}
        </span>
      ))}
      {band ? <span className="text-bf-text-muted">{band}</span> : null}
    </div>
  );
}
