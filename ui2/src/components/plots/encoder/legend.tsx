/**
 * Legend pieces for population series (v1 visual 8): a condition's swatch
 * is its line drawn over its tinted band, as in the plot, and the band is
 * named once for the whole legend (`bandLegendText` in markLabels.ts).
 */

/** Line over a tinted 6 px band rect, in the condition's data colour. */
export function SeriesLegendSwatch({ color, band }: { color: string; band: boolean }) {
  return (
    <svg aria-hidden width={14} height={8} className="shrink-0" data-testid="series-legend-swatch">
      {band ? <rect x={0} y={1} width={14} height={6} fill={color} fillOpacity={0.15} /> : null}
      <line x1={0} x2={14} y1={4} y2={4} stroke={color} strokeWidth={1.5} />
    </svg>
  );
}
