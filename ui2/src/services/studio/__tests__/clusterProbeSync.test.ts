import { afterEach, describe, expect, it, vi } from 'vitest';
import { populationProbeActions } from '../PopulationProbeActions';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useClusterStore, type ClusterResult } from '@/stores/clusterStore';

// REVIEW M2: a pinned cluster probe follows the cluster table by cluster identity (peak),
// never sampling an old label volume under a new caption.
const cluster = (id: number, peakMm: [number, number, number], sign: 'positive' | 'negative' = 'positive') =>
  ({ id, peakMm, sign, voxelCount: 10 }) as never;
const result = (labelVolumeId: string, clusters: unknown[]): ClusterResult =>
  ({ layerId: 'z', layerName: 'zmap_synthetic.nii.gz', table: { labelVolumeId, clusters }, regions: [], computedAt: 0 }) as never;
const pinCluster = (volumeId: string, id: number) =>
  useSetStudioStore.setState((s) => ({
    population: {
      ...s.population,
      pinnedProbe: {
        supportKey: 'k',
        worldMm: [0, 0, 0],
        radiusMm: 0,
        reduce: 'mean',
        region: { locus: { labelSource: { type: 'volume', volumeId }, labelIds: [id] }, label: `cluster ${id} of zmap_synthetic` },
      },
    },
  }) as never);

describe('pinned cluster probe across a cluster recompute', () => {
  afterEach(() => vi.restoreAllMocks());

  it('re-pins the same cluster (same peak) on the new table, under its new id', () => {
    const pin = vi.spyOn(populationProbeActions, 'pinRegion').mockImplementation(() => undefined as never);
    useClusterStore.setState({ result: result('v1', [cluster(1, [-39.5, -19.5, 50.5]), cluster(2, [0.5, 40.5, 10.5], 'negative')]) });
    pinCluster('v1', 2);
    const issue = vi.fn();
    const stop = populationProbeActions.followClusterTable(issue);
    // Recompute: ids re-rank, a new label volume.
    useClusterStore.setState({ result: result('v2', [cluster(1, [0.5, 40.5, 10.5], 'negative'), cluster(2, [-39.5, -19.5, 50.5])]) });
    stop();
    expect(pin).toHaveBeenCalledWith({
      locus: { labelSource: { type: 'volume', volumeId: 'v2' }, labelIds: [1] },
      label: 'cluster 1 of zmap_synthetic',
    });
    expect(issue).not.toHaveBeenCalled();
  });

  it('a cluster that is gone returns the probe to a point and says why', () => {
    const clear = vi.spyOn(populationProbeActions, 'clearRegion').mockImplementation(() => undefined);
    const pin = vi.spyOn(populationProbeActions, 'pinRegion');
    useClusterStore.setState({ result: result('v1', [cluster(1, [-39.5, -19.5, 50.5])]) });
    pinCluster('v1', 1);
    const issue = vi.fn();
    const stop = populationProbeActions.followClusterTable(issue);
    useClusterStore.setState({ result: result('v3', [cluster(1, [42.5, -59.5, -9.5])]) });
    stop();
    expect(pin).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalled();
    expect(issue).toHaveBeenCalledWith(expect.stringMatching(/cluster table changed/));
  });

  it('a probe already stale when a panel starts listening is resolved at once', () => {
    const clear = vi.spyOn(populationProbeActions, 'clearRegion').mockImplementation(() => undefined);
    useClusterStore.setState({ result: result('v9', [cluster(1, [-39.5, -19.5, 50.5])]) });
    pinCluster('v1', 1);
    const issue = vi.fn();
    populationProbeActions.followClusterTable(issue)();
    expect(clear).toHaveBeenCalled();
    expect(issue).toHaveBeenCalled();
  });
});
