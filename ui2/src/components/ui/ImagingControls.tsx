/** Store-free imaging controls shared by native and browser hosts. */
import React, { useId, useState } from 'react';
import { ThresholdText } from './ThresholdText';
import { ColormapPicker } from './ColormapPicker';
import {
  FieldRow,
  RangeSlider,
  Slider,
  SLIDER_THUMB_INSET_PX,
  ValueChip,
  ValueChipError,
} from './bf';
import { isThresholdActive, thresholdWording } from '@/components/views/viewportFrame/frameFormat';

const formatPercent = (value: number) => `${Math.round(value * 100)}%`;
export function OpacityControl({
  value,
  onChange,
  label = 'Opacity',
  stacked = false,
}: {
  value: number;
  onChange: (value: number) => void;
  label?: string;
  stacked?: boolean;
}) {
  return (
    <FieldRow label={label} layout={stacked ? 'stacked' : undefined}>
      <Slider
        label={label}
        value={value}
        min={0}
        max={1}
        step={0.01}
        snap={0.01}
        format={formatPercent}
        valueText={formatPercent}
        showValue
        className={stacked ? 'w-full' : 'flex-1'}
        onValueChange={(next) => {
          const rounded = Math.round(next * 100) / 100;
          if (Number.isFinite(rounded) && rounded >= 0 && rounded <= 1 && rounded !== value)
            onChange(rounded);
        }}
      />
    </FieldRow>
  );
}

/**
 * Intensity / Threshold: a stacked field row holding the shared RangeSlider
 * (data-range marks under the track, the threshold's hidden band + colorbar
 * caption) with a compact "low to high" readout of editable value chips
 * right-aligned on the label line, above the track.
 *
 * Behaviour carried over from the former RangeBlock:
 * - the value clamp and the ruler are the caller's shared ruler [min, max],
 *   frozen during an interaction (the slider's own freeze plus
 *   `onInteraction` for the other range and the colormap strip);
 * - keyboard steps are span / 200 of that ruler, never snapped (`step="any"`);
 *   Home / End reach the ruler's exact ends; low ≤ high;
 * - a change that leaves both ends as they are writes nothing.
 */
export function DisplayRange({
  label,
  low,
  high,
  min,
  max,
  dataRange = null,
  mode = 'shown',
  symbol = 'value',
  onInteraction,
  allowRangeExpansion = false,
  onChange,
}: {
  label: string;
  low: number;
  high: number;
  min: number;
  max: number;
  dataRange?: readonly [number, number] | null;
  mode?: 'shown' | 'hidden';
  /** Variable named in the hidden-band wording ("z", default "value"). */
  symbol?: string;
  allowRangeExpansion?: boolean;
  onInteraction?: (active: boolean, domain: readonly [number, number]) => void;
  onChange: (low: number, high: number) => void;
}) {
  const wording = mode === 'hidden' ? thresholdWording([low, high], symbol) : null;
  // An invalid chip draft reports here; its message renders in flow UNDER
  // the slider (never floated over the track and thumbs).
  const [invalidEnds, setInvalidEnds] = useState<{ low: boolean; high: boolean }>({
    low: false,
    high: false,
  });
  const chipErrorId = `${useId().replace(/:/g, '')}-chip-error`;
  const commit = (nextLow: number, nextHigh: number) => {
    if (Object.is(nextLow, low) && Object.is(nextHigh, high)) return;
    onChange(nextLow, nextHigh);
  };
  // Compact readout on the label line, right-aligned: "33.51 to 249.35",
  // both ends editable chips (clamped to the ruler, low ≤ high). Kept off the
  // track ends so the numbers never read as the ruler's domain.
  const readout = (
    <span
      dir="ltr"
      data-testid="range-readout"
      className="flex items-baseline gap-1 [unicode-bidi:isolate]"
    >
      <ValueChip
        value={low}
        label={`${label} low`}
        min={allowRangeExpansion ? undefined : min}
        max={allowRangeExpansion ? undefined : max}
        align="end"
        errorId={chipErrorId}
        onInvalidChange={(bad) =>
          setInvalidEnds((prev) => (prev.low === bad ? prev : { ...prev, low: bad }))
        }
        onCommit={(v) => commit(Math.min(v, high), high)}
      />
      <span aria-hidden className="font-sans">
        to
      </span>
      <ValueChip
        value={high}
        label={`${label} high`}
        min={allowRangeExpansion ? undefined : min}
        max={allowRangeExpansion ? undefined : max}
        align="end"
        errorId={chipErrorId}
        onInvalidChange={(bad) =>
          setInvalidEnds((prev) => (prev.high === bad ? prev : { ...prev, high: bad }))
        }
        onCommit={(v) => commit(low, Math.max(v, low))}
      />
    </span>
  );
  return (
    <div>
      <FieldRow label={label} layout="stacked" meta={readout}>
        <RangeSlider
          label={label}
          value={[low, high]}
          min={min}
          max={max}
          mode={mode}
          // Same rule as the colorbar: [0, 0] / [0, 100] hide nothing (no hatch).
          hiddenActive={mode === 'hidden' ? isThresholdActive([low, high]) : undefined}
          dataRange={dataRange}
          className="flex-1"
          caption={
            wording ? (
              <span data-testid="threshold-caption" className="block text-right">
                <ThresholdText line={wording} variable={symbol ?? 'value'} />
              </span>
            ) : undefined
          }
          onInteraction={onInteraction}
          onValueChange={([nextLow, nextHigh]) => commit(nextLow, nextHigh)}
        />
      </FieldRow>
      <ValueChipError id={chipErrorId} show={invalidEnds.low || invalidEnds.high} />
    </div>
  );
}

/**
 * The enhanced ColormapPicker variant renders its own "COLORMAP <name>" label
 * row above a thin gradient button — fits the inspector's typography exactly.
 * Let the picker own the whole row so the chrome doesn't collide.
 */
export function ColormapControl({
  value,
  onChange,
  hiddenBand: band = null,
  windowSpan = null,
  options,
}: {
  options?: readonly string[];
  windowSpan?: readonly [number, number] | null;
  value: string;
  onChange: (next: string) => void;
  hiddenBand?: readonly [number, number] | null;
}) {
  // The strip's gradient spans its padding box (inside a 1px border). Inset
  // the border box so that box lands on the sliders' ruler box, which is
  // inset by SLIDER_THUMB_INSET_PX: one value, one x on all three.
  // Forced colors: the strip is data colour, so its trigger (the only button
  // here; the picker's list portals out) opts out of colour forcing, or the
  // gradient is dropped and the strip renders as an empty box.
  return (
    <div
      className="py-1 [&>div]:!mb-0 [&_button]:[forced-color-adjust:none]"
      style={{
        paddingLeft: SLIDER_THUMB_INSET_PX - 1,
        paddingRight: SLIDER_THUMB_INSET_PX - 1,
      }}
    >
      <ColormapPicker
        value={value}
        onChange={onChange}
        variant="enhanced"
        options={options}
        hiddenBand={band}
        windowSpan={windowSpan}
      />
    </div>
  );
}
