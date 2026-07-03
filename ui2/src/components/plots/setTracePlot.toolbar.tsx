/**
 * Band selector for the cross-set trace toolbar. In its own file so the mode
 * module (which exports a non-component `PlotMode` object) keeps a clean
 * fast-refresh boundary.
 */

import { usePlotSpecStore } from '@/stores/plotSpecStore';
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
  color: 'var(--app-text-muted)',
  whiteSpace: 'nowrap',
};

const selectStyle: React.CSSProperties = {
  appearance: 'none',
  WebkitAppearance: 'none',
  MozAppearance: 'none',
  fontSize: 11,
  height: 20,
  padding: '0 18px 0 6px',
  borderRadius: 'var(--app-radius-sm, 4px)',
  border: '1px solid var(--app-border, #2a2a2a)',
  backgroundColor: 'var(--app-input-bg, rgba(255, 255, 255, 0.04))',
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='6'%3E%3Cpath d='M1 1l3 3 3-3' fill='none' stroke='%238a93a3' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 6px center',
  color: 'var(--app-text-primary, var(--app-text, inherit))',
  cursor: 'pointer',
  outline: 'none',
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
