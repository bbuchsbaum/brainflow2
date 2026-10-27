import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/services/apiService', () => ({ getApiService: () => ({}) }));
const sample = vi.hoisted(() => vi.fn());
vi.mock('@/services/SampleProvider', () => ({ sampleProvider: { sample } }));

import type { SampleRequest } from '@/plotting';
import mni from '@/devHarness/fixtures/app/mni_2mm.json';
import { firSet, sampleFirMember } from '@/devHarness/app/firStudy';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useSeriesStore } from '@/stores/seriesStore';
import { useLayerStore } from '@/stores/layerStore';
import { SetSeriesPlot } from '../SetSeriesPlot';
import { resolveSeriesSource } from '../seriesSource.helpers';

const grid = { dims: mni.dims, affine: mni.affine };
const ctx = { layerId: undefined, layerName: undefined, crosshairMm: [-39.5, -19.5, 50.5] as const, width: 800, height: 420 };

describe('Series mode on a dataset (E5)', () => {
  beforeEach(() => {
    sample.mockReset();
    sample.mockImplementation(async (request: SampleRequest) => {
      const locus = request.locus as Extract<SampleRequest['locus'], { kind: 'set' }>;
      return {
        columns: [
          { name: 'member', role: 'nominal' },
          { name: 'value', role: 'quantitative' },
          ...(locus.members[0]?.designValues ?? []).map((d) => ({ name: d.column, role: 'nominal' })),
        ],
        rows: locus.members.map((m) => ({
          member: m.memberId,
          value: sampleFirMember(grid, m.sourcePath, m.stackIndex, locus.worldMm, locus.radiusMm)!.value,
          ...Object.fromEntries((m.designValues ?? []).map((d) => [d.column, d.value])),
        })),
      };
    });
    useSeriesStore.getState().reset();
    useSetStudioStore.getState().bootstrapStudio({
      set: firSet('3d'),
      features: [{ id: 'fir', label: 'FIR beta', kind: 'volume' }],
      cohorts: [],
      expressions: [],
    } as never);
  });

  it('samples the crosshair sphere once and draws one line per condition with a CI band', async () => {
    render(<SetSeriesPlot ctx={ctx} />);
    await waitFor(() => expect(screen.getByTestId('series-legend')).toHaveTextContent('faceshouses'));
    expect(sample).toHaveBeenCalledTimes(1);
    const request = sample.mock.calls[0][0] as SampleRequest;
    expect(request.locus).toMatchObject({ kind: 'set', radiusMm: 6, worldMm: [-39.5, -19.5, 50.5] });
    expect(screen.getByTestId('series-caption')).toHaveTextContent('Lag (TR) · mean ± 95% CI (t, df = 5) · 6 participants · 6 mm sphere');
    expect(screen.getAllByTestId('plot-band')).toHaveLength(2);
  });

  it('a voxel locus samples radius 0; a paired difference leaves one line', async () => {
    render(<SetSeriesPlot ctx={ctx} />);
    await waitFor(() => expect(screen.getByTestId('series-legend')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('radio', { name: 'Voxel' }));
    await waitFor(() => expect((sample.mock.calls.at(-1)![0] as SampleRequest).locus).toMatchObject({ radiusMm: 0 }));
    // Transforms sit behind a disclosure (v1: ≤ 2 control rows).
    fireEvent.click(screen.getByRole('button', { name: /Transforms/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Difference' }));
    await waitFor(() => expect(screen.getByTestId('series-legend')).toHaveTextContent('faces − houses'));
    expect(screen.getByTestId('series-caption')).toHaveTextContent('faces − houses, paired');
  });

  it('participants: one line per participant and condition; clicking a point focuses its observation', async () => {
    useSeriesStore.getState().update({ display: 'participants' });
    render(<SetSeriesPlot ctx={ctx} />);
    await waitFor(() => expect(screen.getAllByTestId('plot-series')).toHaveLength(12));
    const point = document.querySelector('[data-datum-id]') as SVGElement;
    fireEvent.click(point);
    expect(useSetStudioStore.getState().selection.activeMemberId).toMatch(/^s0\d_(faces|houses)_l\d$/);
  });
});

describe('region locus: a parcel picked from the legend (E2)', () => {
  it('samples the picked parcel as a region of its label layer', async () => {
    useLayerStore.setState({
      layers: [
        {
          id: 'atlas',
          name: 'atlas-synth3_dseg.nii.gz',
          volumeId: 'atlas',
          type: 'label',
          visible: true,
          order: 0,
          atlasPaletteLegend: [
            { label_id: 1, roi: 'L_sensorimotor', color: [255, 0, 0] },
            { label_id: 2, roi: 'R_occipitotemporal', color: [0, 255, 0] },
          ],
        },
      ],
    } as never);
    sample.mockClear();
    render(<SetSeriesPlot ctx={ctx} />);
    await waitFor(() => expect(sample).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('radio', { name: 'Region' }));
    fireEvent.change(screen.getByLabelText('Series region'), { target: { value: '2' } });
    await waitFor(() =>
      expect((sample.mock.calls.at(-1)![0] as SampleRequest).locus).toMatchObject({
        region: { labelSource: { type: 'layer', layerId: 'atlas' }, labelIds: [2] },
      }),
    );
    await waitFor(() => expect(screen.getByTestId('series-caption')).toHaveTextContent(/region .*occipitotemporal/));
  });
});

describe('round-1 fixes: stale data, window mean, CSV, validation (v1 G1/G2/G3/H4/H5)', () => {
  beforeEach(() => {
    useLayerStore.setState({ layers: [] } as never);
    useSeriesStore.getState().reset();
    useSetStudioStore.getState().bootstrapStudio({
      set: firSet('3d'),
      features: [{ id: 'fir', label: 'FIR beta', kind: 'volume' }],
      cohorts: [],
      expressions: [],
    } as never);
  });

  it('a failed Region locus clears the plot, captions nothing stale, and offers Load atlas', async () => {
    render(<SetSeriesPlot ctx={ctx} />);
    await waitFor(() => expect(screen.getAllByTestId('plot-band').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('radio', { name: 'Region' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('No series:'));
    expect(screen.queryAllByTestId('plot-band')).toHaveLength(0);
    expect(screen.getByTestId('series-caption')).not.toHaveTextContent('sphere');
    expect(screen.getByRole('button', { name: 'Load atlas…' })).toBeInTheDocument();
  });

  it('mean over a peak window: one point per condition with error bars; the window is stated', async () => {
    render(<SetSeriesPlot ctx={ctx} />);
    await waitFor(() => expect(screen.getByTestId('series-legend')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Transforms/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mean over window' }));
    // Default: the population peak (lag 2) ± 1, never the whole axis.
    await waitFor(() => expect(screen.getByTestId('series-caption')).toHaveTextContent('Mean over 1–3'));
    expect(screen.getAllByTestId('plot-error-bar')).toHaveLength(2);
  });

  it('Copy CSV: per condition × lag, n, centre, band and its definition, under the caption', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<SetSeriesPlot ctx={ctx} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy CSV' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Copy CSV' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const csv = String((writeText.mock.calls[0] as unknown[])[0]).split('\n');
    expect(csv[0]).toMatch(/^# Lag \(TR\) · mean \+\/- 95% CI \(t, df = 5\)/);
    expect(csv[1]).toBe('lag_TR,condition,n,mean,band_low,band_high,band_definition');
    expect(csv).toHaveLength(2 + 16 + 1);
    expect(csv[2].split(',').slice(1, 3)).toEqual(['faces', '6']);
  });

  it('a blank or non-positive radius is marked with a message, not silently reverted', async () => {
    render(<SetSeriesPlot ctx={ctx} />);
    const radius = await screen.findByLabelText('Series sphere radius');
    fireEvent.change(radius, { target: { value: '0' } });
    expect(radius).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Radius must be > 0 mm (Voxel samples one voxel)')).toBeInTheDocument();
    expect(useSeriesStore.getState().radiusMm).toBe(6);
  });
});

describe('series source', () => {
  it('auto follows the workspace; an explicit choice wins when available', () => {
    expect(resolveSeriesSource('auto', { layer: true, set: true }, false)).toBe('layer');
    expect(resolveSeriesSource('auto', { layer: true, set: true }, true)).toBe('set');
    expect(resolveSeriesSource('set', { layer: true, set: false }, true)).toBe('layer');
    expect(resolveSeriesSource('auto', { layer: false, set: false }, false)).toBeNull();
  });
});

