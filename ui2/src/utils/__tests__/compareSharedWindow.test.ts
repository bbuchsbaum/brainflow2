import { beforeEach, describe, expect, it } from 'vitest';
import { useLayerStore } from '@/stores/layerStore';
import { useComparisonStore } from '@/stores/comparisonStore';
import { sameStatisticLayerIds } from '../compareSharedWindow';

const stat = (kind: 'z' | 't', label: string, dof: number[] = [], inferred = false) => ({
  kind,
  intentCode: inferred ? 0 : kind === 'z' ? 5 : 3,
  intentParams: [0, 0, 0],
  intentName: inferred ? 'inferred from file name' : '',
  dof,
  label,
  fromDescription: false,
  positiveDataLabel: null,
});

function seed(panelLayers: string[][], overrides: Record<number, Record<string, unknown>> = {}) {
  useLayerStore.setState({
    layers: [
      { id: 'z1', name: 'zmap_a.nii.gz', volumeId: 'z1', type: 'volume', statistic: stat('z', 'z') },
      { id: 'z2', name: 'zmap_b.nii.gz', volumeId: 'z2', type: 'volume', statistic: stat('z', 'z') },
      { id: 'zg', name: 'guess_zstat.nii.gz', volumeId: 'zg', type: 'volume', statistic: stat('z', 'z', [], true) },
      { id: 't24', name: 't24.nii.gz', volumeId: 't24', type: 'volume', statistic: stat('t', 't(24)', [24]) },
      { id: 't12', name: 't12.nii.gz', volumeId: 't12', type: 'volume', statistic: stat('t', 't(12)', [12]) },
      { id: 't24b', name: 't24b.nii.gz', volumeId: 't24b', type: 'volume', statistic: stat('t', 't(24)', [24]) },
      { id: 'z3', name: 'zmap_off.nii.gz', volumeId: 'z3', type: 'volume', statistic: stat('z', 'z') },
    ] as never,
    layerMetadata: new Map(),
  });
  useComparisonStore.setState({
    panels: new Map([
      [
        'ws',
        panelLayers.map((ids, i) => ({
          id: `p${i}`,
          label: `Panel ${'AB'[i]}`,
          visibleLayerIds: new Set(ids),
          viewType: 'axial' as const,
          renderOverrides: overrides[i] as never,
        })),
      ],
    ]),
  });
}

describe('Compare shared window (v4 fidelity critic)', () => {
  beforeEach(() => seed([['z1', 'zg', 't24', 't12'], ['z2', 't24b']]));

  it('shares z with a declared z shown in a panel, never with a guessed z* or a layer not shown', () => {
    expect(sameStatisticLayerIds('z1', 'ws')).toEqual({ ids: ['z2'], held: [] });
  });

  it('matches df: t(24) with t(24), not t(12)', () => {
    expect(sameStatisticLayerIds('t24', 'ws').ids).toEqual(['t24b']);
  });

  it('a guessed statistic shares with nothing', () => {
    expect(sameStatisticLayerIds('zg', 'ws')).toEqual({ ids: [], held: [] });
  });

  it('leaves a panel-held window alone and reports it', () => {
    seed([['z1'], ['z2']], { 1: { z2: { intensity: [-3, 3] } } });
    expect(sameStatisticLayerIds('z1', 'ws')).toEqual({ ids: [], held: ['zmap_b (Panel B)'] });
  });
});
