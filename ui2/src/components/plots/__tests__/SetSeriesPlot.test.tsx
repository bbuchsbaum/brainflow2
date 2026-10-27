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
    expect(screen.getByTestId('series-caption')).toHaveTextContent('Lag (TR) · mean ± 95% CI (t) · 6 participants · 6 mm sphere');
    expect(screen.getAllByTestId('plot-band')).toHaveLength(2);
  });

  it('a voxel locus samples radius 0; a paired difference leaves one line', async () => {
    render(<SetSeriesPlot ctx={ctx} />);
    await waitFor(() => expect(screen.getByTestId('series-legend')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('radio', { name: 'Voxel' }));
    await waitFor(() => expect((sample.mock.calls.at(-1)![0] as SampleRequest).locus).toMatchObject({ radiusMm: 0 }));
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

describe('series source', () => {
  it('auto follows the workspace; an explicit choice wins when available', () => {
    expect(resolveSeriesSource('auto', { layer: true, set: true }, false)).toBe('layer');
    expect(resolveSeriesSource('auto', { layer: true, set: true }, true)).toBe('set');
    expect(resolveSeriesSource('set', { layer: true, set: false }, true)).toBe('layer');
    expect(resolveSeriesSource('auto', { layer: false, set: false }, false)).toBeNull();
  });
});

