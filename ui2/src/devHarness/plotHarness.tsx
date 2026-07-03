/* eslint-disable react-refresh/only-export-components -- dev-only entry module
 * (mounts to the DOM, exports nothing); fast-refresh boundaries don't apply. */

/**
 * Dev-only visual harness for the cross-set trace visual mode (P5).
 *
 * Renders the trace marks — line + CI band, and the carpet/grayplot heatmap —
 * through the real {@link PlotEncoder}/{@link resolveSpec} path with mocked
 * SampleFrames, so the rendering half of P5 can be eyeballed (and screenshotted
 * by browser automation) WITHOUT the Tauri backend. This is not part of the app
 * bundle (the production build's only html input is index.html); it is served by
 * Vite dev at /plot-harness.html.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { PlotEncoder } from '@/components/plots/encoder/PlotEncoder';
import { column, resolveSpec } from '@/plotting';
import type { PlotSpec, SampleFrame } from '@/plotting';

// Tokens the marks read (--app-plot-line etc.) are defined inline in
// plot-harness.html — importing the app theme.css standalone trips Tailwind's
// `@layer base` (which is only set up via the full index.css pipeline).

const PANEL_W = 380;
const PANEL_H = 240;

/** A cross-set trace frame (members on x, a value + CI band each). */
function traceFrame(
  rows: {
    member: string;
    value: number | null;
    lower: number | null;
    upper: number | null;
  }[],
  extraCols: { memberLabel?: boolean } = {},
): SampleFrame {
  const cols = [column('member', 'nominal')];
  if (extraCols.memberLabel) cols.push(column('memberLabel', 'nominal'));
  cols.push(
    column('value', 'quantitative'),
    column('lower', 'quantitative'),
    column('upper', 'quantitative'),
  );
  return {
    columns: cols,
    rows,
    meta: {
      suggested: {
        mark: 'line',
        encoding: {
          x: extraCols.memberLabel ? 'memberLabel' : 'member',
          y: 'value',
        },
        band: { lower: 'lower', upper: 'upper' },
      },
    },
  };
}

const THREE = traceFrame([
  { member: 'sub01', value: 2.1, lower: 1.6, upper: 2.6 },
  { member: 'sub02', value: 3.8, lower: 3.1, upper: 4.5 },
  { member: 'sub03', value: 3.0, lower: 2.5, upper: 3.5 },
]);

const MANY = traceFrame(
  Array.from({ length: 12 }, (_, i) => {
    const v = 2 + Math.sin(i / 1.7) * 1.2 + i * 0.08;
    const half = 0.3 + 0.15 * ((i % 3) + 1);
    return {
      member: `sub${String(i + 1).padStart(2, '0')}`,
      value: v,
      lower: v - half,
      upper: v + half,
    };
  }),
);

const LABELLED: SampleFrame = {
  columns: [
    column('member', 'nominal'),
    column('memberLabel', 'nominal'),
    column('condition', 'nominal'),
    column('value', 'quantitative'),
    column('lower', 'quantitative'),
    column('upper', 'quantitative'),
  ],
  rows: [
    {
      member: 'm1',
      memberLabel: 'sub-01 · faces',
      condition: 'faces',
      value: 2.2,
      lower: 1.7,
      upper: 2.7,
    },
    {
      member: 'm2',
      memberLabel: 'sub-02 · faces',
      condition: 'faces',
      value: 2.9,
      lower: 2.3,
      upper: 3.5,
    },
    {
      member: 'm3',
      memberLabel: 'sub-01 · house',
      condition: 'house',
      value: 4.1,
      lower: 3.4,
      upper: 4.8,
    },
    {
      member: 'm4',
      memberLabel: 'sub-02 · house',
      condition: 'house',
      value: 3.6,
      lower: 3.0,
      upper: 4.2,
    },
  ],
  meta: {
    suggested: {
      mark: 'line',
      encoding: { x: 'memberLabel', y: 'value' },
      band: { lower: 'lower', upper: 'upper' },
    },
  },
};

const WITH_GAP = traceFrame([
  { member: 'sub01', value: 2.1, lower: 1.6, upper: 2.6 },
  { member: 'sub02', value: null, lower: null, upper: null },
  { member: 'sub03', value: 3.4, lower: 2.9, upper: 3.9 },
]);

// band = 'none' collapses lower/upper onto the value (flat ribbon, just a line).
const FLAT_BAND = traceFrame([
  { member: 'sub01', value: 2.1, lower: 2.1, upper: 2.1 },
  { member: 'sub02', value: 3.8, lower: 3.8, upper: 3.8 },
  { member: 'sub03', value: 3.0, lower: 3.0, upper: 3.0 },
]);

const ONE = traceFrame([{ member: 'sub01', value: 2.5, lower: 2.0, upper: 3.0 }]);

interface Scenario {
  title: string;
  frame: SampleFrame;
  override?: Partial<PlotSpec>;
  width?: number;
  height?: number;
}

const SCENARIOS: Scenario[] = [
  { title: 'Line + 95% CI band (3 members)', frame: THREE },
  { title: 'Heatmap / carpet (3 members)', frame: THREE, override: { mark: 'heatmap' } },
  { title: 'Line + band, 12 members', frame: MANY },
  { title: 'Heatmap, 12 members', frame: MANY, override: { mark: 'heatmap' } },
  { title: 'Ontology-labelled member axis', frame: LABELLED },
  { title: 'Missing member (gap) — line', frame: WITH_GAP },
  { title: 'Missing member (gap) — heatmap', frame: WITH_GAP, override: { mark: 'heatmap' } },
  { title: 'band=none (flat ribbon)', frame: FLAT_BAND },
  { title: 'Single member — heatmap', frame: ONE, override: { mark: 'heatmap' } },
  { title: 'Single member — line (empty state)', frame: ONE },
  { title: 'Degenerate width (no crash)', frame: THREE, width: 44, height: 120 },
];

function Panel({ scenario }: { scenario: Scenario }) {
  const w = scenario.width ?? PANEL_W;
  const h = scenario.height ?? PANEL_H;
  const spec = resolveSpec(scenario.frame, scenario.override ?? null);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 10,
        border: '1px solid var(--app-border, #2a2a2a)',
        borderRadius: 8,
        background: 'var(--app-bg-elevated, #12161c)',
      }}
    >
      <div
        style={{ fontSize: 12, color: 'var(--app-text-muted, #7f8fa3)', fontFamily: 'monospace' }}
      >
        {scenario.title} · mark={spec.mark}
        {spec.band ? ' · band' : ''}
      </div>
      <div style={{ width: w, height: h }}>
        <PlotEncoder frame={scenario.frame} spec={spec} width={w} height={h} />
      </div>
    </div>
  );
}

function Harness() {
  return (
    <div
      data-testid="plot-harness"
      style={{
        minHeight: '100vh',
        padding: 20,
        background: 'var(--app-bg, #0b0e13)',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 16,
        alignItems: 'flex-start',
      }}
    >
      {SCENARIOS.map((s) => (
        <Panel key={s.title} scenario={s} />
      ))}
    </div>
  );
}

const el = document.getElementById('root');
if (el) {
  createRoot(el).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
}
