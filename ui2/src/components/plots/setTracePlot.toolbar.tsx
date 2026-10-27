/**
 * Band selector for the cross-set trace toolbar. In its own file so the mode
 * module (which exports a non-component `PlotMode` object) keeps a clean
 * fast-refresh boundary.
 */

import { usePlotSpecStore } from '@/stores/plotSpecStore';

import { Select, ToolbarField } from '@/components/ui/bf';
import type { TraceBand } from '@/plotting';

import { SET_TRACE_MODE_ID } from './setTracePlot.helpers';

const BAND_OPTIONS: { value: TraceBand; label: string }[] = [
  { value: 'sem95', label: '95% CI (mean)' },
  { value: 'sd', label: '±1 SD' },
  { value: 'ci95', label: '2.5–97.5%' },
  { value: 'iqr', label: 'IQR' },
  { value: 'none', label: 'None' },
];

export function BandToolbar() {
  const band = usePlotSpecStore((s) => s.bandByMode[SET_TRACE_MODE_ID] ?? 'sem95');
  const setBand = usePlotSpecStore((s) => s.setBand);
  return (
    <ToolbarField label="Band">
      <Select
        aria-label="Dispersion band"
        value={band}
        options={BAND_OPTIONS}
        onValueChange={(v) => setBand(SET_TRACE_MODE_ID, v as TraceBand)}
        className="w-auto max-w-[140px]"
      />
    </ToolbarField>
  );
}

export default BandToolbar;
