/**
 * Band selector for the cross-set trace toolbar. In its own file so the mode
 * module (which exports a non-component `PlotMode` object) keeps a clean
 * fast-refresh boundary.
 */

import { usePlotSpecStore } from '@/stores/plotSpecStore';

import { PLOT_FOCUS_RING } from './PlotHost';
import type { TraceBand } from '@/plotting';

import { SET_TRACE_MODE_ID } from './setTracePlot.helpers';

const BAND_OPTIONS: { value: TraceBand; label: string }[] = [
  { value: 'sem95', label: '95% CI (mean)' },
  { value: 'sd', label: '±1 SD' },
  { value: 'ci95', label: '2.5–97.5%' },
  { value: 'iqr', label: 'IQR' },
  { value: 'none', label: 'None' },
];

const labelStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 11,
  color: 'var(--bf-text-muted)',
  whiteSpace: 'nowrap',
};

// Chrome (flat surface, border, chevron, focus) comes from the shared
// `bf-select` class in theme.css; only the compact toolbar sizing is local.
const selectStyle: React.CSSProperties = {
  fontSize: 11,
  height: 20,
  maxWidth: 140,
};

export function BandToolbar() {
  const band = usePlotSpecStore((s) => s.bandByMode[SET_TRACE_MODE_ID] ?? 'sem95');
  const setBand = usePlotSpecStore((s) => s.setBand);
  return (
    <label style={labelStyle}>
      Band
      <select
        aria-label="Dispersion band"
        value={band}
        onChange={(e) => setBand(SET_TRACE_MODE_ID, e.currentTarget.value as TraceBand)}
        style={selectStyle}
        className={`bf-select ${PLOT_FOCUS_RING}`}
      >
        {BAND_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export default BandToolbar;
