/**
 * Band selector for the cross-set trace toolbar. In its own file so the mode
 * module (which exports a non-component `PlotMode` object) keeps a clean
 * fast-refresh boundary.
 */

import { usePlotSpecStore } from '@/stores/plotSpecStore';

import { Select, ToolbarField } from '@/components/ui/bf';
import { intervalKey, intervalOptions, parseIntervalKey } from '@/plotting/intervals';

import { DEFAULT_TRACE_BAND, SET_TRACE_MODE_ID, TRACE_BAND_CHOICES } from './setTracePlot.helpers';

const BAND_OPTIONS = intervalOptions(TRACE_BAND_CHOICES, 'short');

export function BandToolbar() {
  const band = usePlotSpecStore((s) => s.bandByMode[SET_TRACE_MODE_ID] ?? DEFAULT_TRACE_BAND);
  const setBand = usePlotSpecStore((s) => s.setBand);
  return (
    <ToolbarField label="Band">
      <Select
        aria-label="Dispersion band"
        value={intervalKey(band)}
        options={BAND_OPTIONS}
        onValueChange={(v) => {
          const choice = parseIntervalKey(v);
          if (choice) setBand(SET_TRACE_MODE_ID, choice);
        }}
        className="w-auto max-w-[140px]"
      />
    </ToolbarField>
  );
}

export default BandToolbar;
