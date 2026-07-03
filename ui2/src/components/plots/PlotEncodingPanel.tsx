/**
 * PlotEncodingPanel — the generic encoding/params strip.
 *
 * Driven entirely by the frame's columns and the per-mode override in
 * {@link usePlotSpecStore}: a mark switch, channel→column dropdowns, and (for
 * spatial loci) the sphere-radius / reducer sampling controls. It is plot-type
 * agnostic — histogram, time-series and future modes all render the same panel;
 * what differs is only the columns the frame exposes.
 *
 * Mark / channel edits re-render (no re-sample); locus edits change the sample
 * request, so the owning body re-samples (its effect depends on the radius).
 */

import { useMemo } from 'react';

import { resolveSpec } from '@/plotting';
import type { Encoding, Mark, ReduceOp, SampleFrame, Transform } from '@/plotting';
import { usePlotSpecStore } from '@/stores/plotSpecStore';

import { SUPPORTED_MARKS } from './encoder/registry';

/** Sphere radii (mm) offered for spatial sampling. 0 == single voxel. */
const RADIUS_PRESETS_MM = [0, 2, 4, 6, 8, 10] as const;
const REDUCERS: ReduceOp[] = ['mean', 'median', 'min', 'max', 'sum'];
const MARK_LABELS: Record<Mark, string> = {
  line: 'Line',
  area: 'Area',
  point: 'Points',
  bar: 'Bars',
  hist: 'Histogram',
  box: 'Box',
  violin: 'Violin',
  heatmap: 'Heatmap',
};

const labelStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 11,
  color: 'var(--app-text-muted)',
  whiteSpace: 'nowrap',
};
const selectStyle: React.CSSProperties = {
  // Flatten the native macOS select chrome (the glossy "3D bubble" + steppers)
  // to match the app's flat dark controls, and draw our own chevron.
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
  maxWidth: 130,
};

function LabeledSelect({
  label,
  value,
  ariaLabel,
  onChange,
  children,
}: {
  label: string;
  value: string | number;
  ariaLabel: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label style={labelStyle}>
      {label}
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        style={selectStyle}
      >
        {children}
      </select>
    </label>
  );
}

export interface PlotEncodingPanelProps {
  readonly modeId: string;
  readonly frame: SampleFrame;
  /** Show the spatial sampling controls (sphere radius; + reducer when radius > 0). */
  readonly showLocus?: boolean;
  /** Show the reducer control unconditionally (e.g. region sampling). */
  readonly showReduce?: boolean;
}

export function PlotEncodingPanel({
  modeId,
  frame,
  showLocus = false,
  showReduce = false,
}: PlotEncodingPanelProps) {
  const override = usePlotSpecStore((s) => s.specByMode[modeId]);
  const sphereRadiusMm = usePlotSpecStore((s) => s.sphereRadiusMmByMode[modeId] ?? 0);
  const reduce = usePlotSpecStore((s) => s.reduceByMode[modeId] ?? 'mean');
  const setMark = usePlotSpecStore((s) => s.setMark);
  const setEncodingChannel = usePlotSpecStore((s) => s.setEncodingChannel);
  const setSphereRadiusMm = usePlotSpecStore((s) => s.setSphereRadiusMm);
  const setReduce = usePlotSpecStore((s) => s.setReduce);
  const setNormalize = usePlotSpecStore((s) => s.setNormalize);

  const resolved = useMemo(() => resolveSpec(frame, override), [frame, override]);
  const { numericCols, categoricalCols, quantCols } = useMemo(() => {
    const numeric: string[] = [];
    const categorical: string[] = [];
    const quant: string[] = [];
    for (const c of frame.columns) {
      if (c.role === 'quantitative' || c.role === 'temporal') numeric.push(c.name);
      if (c.role === 'quantitative') quant.push(c.name);
      if (c.role === 'nominal' || c.role === 'ordinal') categorical.push(c.name);
    }
    return {
      numericCols: numeric,
      categoricalCols: categorical,
      quantCols: quant,
    };
  }, [frame.columns]);

  // Role-appropriate column choices per channel + mark, so the user can't bind a
  // continuous mark's axis to a non-numeric column (which would silently render
  // nothing). `bar` and `heatmap` accept any column on x (their band scales
  // stringify categories); `hist` keeps x quantitative. Continuous marks
  // (line/area/point) accept numeric OR categorical x — a categorical x lays the
  // line/points on a point scale (e.g. the cross-set trace's member axis).
  const xOptions =
    resolved.mark === 'bar' || resolved.mark === 'heatmap'
      ? frame.columns.map((c) => c.name)
      : resolved.mark === 'hist'
        ? quantCols
        : [...numericCols, ...categoricalCols];

  // Normalize control: offered for continuous marks with a quantitative y
  // (e.g. z-score / %Δ a voxel time-series).
  const yField = resolved.encoding.y;
  const continuousMark =
    resolved.mark === 'line' || resolved.mark === 'area' || resolved.mark === 'point';
  const normalizeMethod =
    resolved.transforms.find(
      (t): t is Extract<Transform, { kind: 'normalize' }> =>
        t.kind === 'normalize' && t.field === yField,
    )?.method ?? '';
  const showNormalize = Boolean(yField) && continuousMark;

  const channelSelect = (
    channel: keyof Encoding,
    label: string,
    options: string[],
    allowNone: boolean,
  ) => (
    <LabeledSelect
      label={label}
      ariaLabel={`${label} channel`}
      value={resolved.encoding[channel] ?? ''}
      onChange={(v) => setEncodingChannel(modeId, channel, v === '' ? null : v)}
    >
      {allowNone && <option value="">—</option>}
      {options.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </LabeledSelect>
  );

  return (
    <div
      data-testid="plot-encoding-panel"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 10,
        padding: '4px 8px',
        borderBottom: '1px solid var(--app-border, #2a2a2a)',
      }}
    >
      <LabeledSelect
        label="Mark"
        ariaLabel="Plot mark"
        value={resolved.mark}
        onChange={(v) => setMark(modeId, v as Mark)}
      >
        {SUPPORTED_MARKS.map((mark) => (
          <option key={mark} value={mark}>
            {MARK_LABELS[mark]}
          </option>
        ))}
      </LabeledSelect>

      {channelSelect('x', 'X', xOptions, false)}
      {channelSelect('y', 'Y', numericCols, resolved.mark === 'hist')}
      {categoricalCols.length > 0 && channelSelect('color', 'Color', categoricalCols, true)}

      {showNormalize && yField && (
        <LabeledSelect
          label="Normalize"
          ariaLabel="Normalize"
          value={normalizeMethod}
          onChange={(v) =>
            setNormalize(modeId, yField, v === '' ? null : (v as 'zscore' | 'percentChange'))
          }
        >
          <option value="">None</option>
          <option value="zscore">z-score</option>
          <option value="percentChange">%Δ</option>
        </LabeledSelect>
      )}

      {showLocus && (
        <LabeledSelect
          label="Sample"
          ariaLabel="Sampling radius"
          value={sphereRadiusMm}
          onChange={(v) => setSphereRadiusMm(modeId, Number(v))}
        >
          {RADIUS_PRESETS_MM.map((mm) => (
            <option key={mm} value={mm}>
              {mm === 0 ? 'Voxel' : `${mm} mm`}
            </option>
          ))}
        </LabeledSelect>
      )}

      {(showReduce || (showLocus && sphereRadiusMm > 0)) && (
        <LabeledSelect
          label="Reduce"
          ariaLabel="Reducer"
          value={reduce}
          onChange={(v) => setReduce(modeId, v as ReduceOp)}
        >
          {REDUCERS.map((op) => (
            <option key={op} value={op}>
              {op}
            </option>
          ))}
        </LabeledSelect>
      )}
    </div>
  );
}

export default PlotEncodingPanel;
