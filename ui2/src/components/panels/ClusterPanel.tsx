import React, { useMemo, useState } from 'react';
import { useLayerStore } from '@/stores/layerStore';
import { useClusterStore } from '@/stores/clusterStore';
import { getClusterService } from '@/services/ClusterService';
import type { ClusterMaskParams } from '@/types/alphaMask';
import { PanelErrorBoundary } from '@/components/common/PanelErrorBoundary';

const defaultParams = (threshold: number): ClusterMaskParams => ({
  threshold,
  min_voxels: 5,
  connectivity: 'Six',
});

interface ClusterPanelProps {
  containerWidth?: number;
  containerHeight?: number;
}

const ClusterPanelContent: React.FC<ClusterPanelProps> = () => {
  const selectedLayerId = useLayerStore((s) => s.selectedLayerId);
  const [threshold, setThreshold] = useState(2.3);
  const [minVox, setMinVox] = useState(5);
  const [connectivity, setConnectivity] = useState<'Six' | 'TwentySix'>('Six');
  const clusterState = useClusterStore((s) => (selectedLayerId ? s.byLayer.get(selectedLayerId) : undefined));

  const disabled = !selectedLayerId;

  const onCompute = async () => {
    if (!selectedLayerId) return;

    useClusterStore.getState().setComputing(selectedLayerId);
    const params = defaultParams(threshold);
    params.min_voxels = minVox;
    params.connectivity = connectivity;
    try {
      const res = await getClusterService().computeAlphaMask(selectedLayerId, params, 'Cluster');
      useClusterStore.getState().setResult(selectedLayerId, res.mask, res.clusters ?? []);
    } catch (err: any) {
      useClusterStore.getState().setError(selectedLayerId, err?.message ?? 'Failed to compute clusters');
    }
  };

  const onClear = async () => {
    if (!selectedLayerId) return;
    await getClusterService().clearAlphaMask(selectedLayerId);
    useClusterStore.getState().clear(selectedLayerId);
  };

  const table = useMemo(() => {
    if (!clusterState || clusterState.summaries.length === 0) return null;
    return (
      <div className="mt-3 overflow-auto max-h-64 border border-border rounded">
        <table className="min-w-full text-sm">
          <thead className="bg-card">
            <tr>
              <th className="px-2 py-1 text-left">ID</th>
              <th className="px-2 py-1 text-left">Vox</th>
              <th className="px-2 py-1 text-left">Peak</th>
              <th className="px-2 py-1 text-left">Centroid (ijk)</th>
            </tr>
          </thead>
          <tbody>
            {clusterState.summaries.map((c) => (
              <tr key={c.id} className="odd:bg-background even:bg-card">
                <td className="px-2 py-1">{c.id}</td>
                <td className="px-2 py-1">{c.size_vox}</td>
                <td className="px-2 py-1">{c.peak_value.toFixed(2)}</td>
                <td className="px-2 py-1">
                  {c.centroid_ijk.map((v) => v.toFixed(1)).join(', ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }, [clusterState]);

  return (
    <div className="p-3 space-y-3 text-sm text-foreground h-full overflow-auto">
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-muted-foreground">Threshold</label>
        <input
          type="number"
          step="0.1"
          value={threshold}
          onChange={(e) => setThreshold(parseFloat(e.target.value))}
          className="bg-background border border-border rounded px-2 py-1 w-20"
        />
        <label className="text-muted-foreground">Min vox</label>
        <input
          type="number"
          min={1}
          value={minVox}
          onChange={(e) => setMinVox(parseInt(e.target.value, 10))}
          className="bg-background border border-border rounded px-2 py-1 w-16"
        />
        <select
          value={connectivity}
          onChange={(e) => setConnectivity(e.target.value as 'Six' | 'TwentySix')}
          className="bg-background border border-border rounded px-2 py-1"
        >
          <option value="Six">6-neighbor</option>
          <option value="TwentySix">26-neighbor</option>
        </select>
        <button
          onClick={onCompute}
          disabled={disabled}
          className="bg-primary hover:bg-primary/90 disabled:bg-muted px-3 py-1 rounded text-sm"
        >
          Compute
        </button>
        <button
          onClick={onClear}
          disabled={disabled}
          className="bg-muted hover:bg-muted/80 disabled:bg-card px-3 py-1 rounded text-sm"
        >
          Clear
        </button>
      </div>
      {clusterState?.status === 'computing' && <div className="text-primary">Computing…</div>}
      {clusterState?.status === 'error' && (
        <div className="text-destructive">Error: {clusterState.error}</div>
      )}
      {table}
      {!clusterState && <div className="text-muted-foreground text-sm">Select a layer to compute clusters.</div>}
    </div>
  );
};

export const ClusterPanel: React.FC<ClusterPanelProps> = (props) => (
  <PanelErrorBoundary panelName="ClusterPanel">
    <ClusterPanelContent {...props} />
  </PanelErrorBoundary>
);

export default ClusterPanel;
