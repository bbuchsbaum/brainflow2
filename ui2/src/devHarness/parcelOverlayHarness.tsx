/** Actual InspectorRouter fixture. Only backend I/O and atlas resources are mocked. */
import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { ParcelOverlayInfo, ParcelTablePreview, SurfaceParcelTable } from '@brainflow/api';
import { InspectorRouter } from '@/components/inspector/InspectorRouter';
import { parcelOverlayService } from '@/services/ParcelOverlayService';
import { surfaceParcelOverlayService } from '@/services/SurfaceParcelOverlayService';
import { atlasRoiService } from '@/services/AtlasRoiService';
import { histogramService } from '@/services/HistogramService';
import { useLayerStore } from '@/stores/layerStore';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useInspectorSelectionStore } from '@/stores/inspectorSelectionStore';
import { buildSceneStack } from '@/hooks/useSceneStack';
import { TemporalMetricSelector } from '@/components/ui/TemporalMetricSelector';
import { Button } from '@/components/ui/Button';
import '@/index.css';

const preview: ParcelTablePreview = {
  atlasName: 'Schaefer 400 · 7 networks',
  atlasParcels: 400,
  headers: ['roi_id', 'linear', 'quadratic', 'cubic'],
  rowCount: 400,
  matchedParcels: 400,
  missingParcels: 0,
  bindingError: null,
  columns: [1, 2, 3].map((power, i) => ({
    name: ['linear', 'quadratic', 'cubic'][i],
    range: [1, 400 ** power],
    finiteCount: 400,
    missingCount: 0,
    error: null,
  })),
  keyExamples: ['1 · 7Networks_LH_Vis_1 · left', '2 · 7Networks_LH_Vis_2 · left'],
  dictionarySha256: 'd'.repeat(64),
  tableSha256: 'a'.repeat(64),
};
const config = {
  atlas_id: 'schaefer',
  space: 'MNI152NLin6Asym',
  resolution: '1mm',
  parcels: 400,
  networks: 7,
};
useWorkspaceStore.setState({
  activeWorkspaceId: 'fixture',
  workspaces: new Map([
    [
      'fixture',
      {
        id: 'fixture',
        type: 'integrated',
        title: 'Integrated',
        timestamp: Date.now(),
        isActive: true,
        layoutConfig: { root: { type: 'row', content: [] } },
        panelStates: new Map(),
      },
    ],
  ]),
});
useLayerStore
  .getState()
  .addLayer({
    id: 'atlas',
    volumeId: 'atlas',
    name: 'Schaefer 400 parcels, 7 networks',
    type: 'label',
    visible: true,
    order: 0,
  });
useLayerStore.getState().setLayerMetadata('atlas', { dataRange: { min: 0, max: 400 } });
useViewStateStore.getState().setViewState((s) => {
  s.layers = [
    {
      id: 'atlas',
      volumeId: 'atlas',
      name: 'Schaefer 400 parcels, 7 networks',
      visible: true,
      opacity: 1,
      colormap: 'categorical',
      layerMode: 'label',
      atlasConfig: config,
      intensity: [-0.5, 400.5],
      threshold: [0, 0],
    },
  ];
});
for (const id of ['lh', 'rh']) {
  useSurfaceStore
    .getState()
    .addSurface({
      handle: id,
      name: `fsaverage ${id}`,
      visible: true,
      geometry: { vertices: new Float32Array(9), faces: new Uint32Array([0, 1, 2]) },
      layers: new Map(),
      metadata: { vertexCount: 3, faceCount: 1, path: 'fixture' },
    });
  useSurfaceStore
    .getState()
    .addDataLayer(id, {
      id: 'parcels',
      name: `Schaefer 400 (${id})`,
      values: new Float32Array([0, 1, 2]),
      labels: new Uint32Array([0, 1, 2]),
      parcelDictionaryId: preview.dictionarySha256,
      colormap: 'categorical',
      range: [0, 400],
      dataRange: [0, 400],
      opacity: 1,
    });
}
const selectVolume = () =>
  useInspectorSelectionStore
    .getState()
    .setActive(buildSceneStack(useLayerStore.getState().layers, new Map(), null).volumes[0]);
selectVolume();
atlasRoiService.locations = async () =>
  Array.from({ length: 400 }, (_, i) => ({
    id: i + 1,
    name: `7Networks_${i < 200 ? 'LH' : 'RH'}_${i < 80 ? 'Vis' : 'SomMot'}_${i + 1}`,
    hemisphere: i < 200 ? 'left' : 'right',
    network: i < 80 ? 'Visual' : 'Somatomotor',
    worldMm: [i - 200, 0, 30],
    voxelCount: 150 + i,
  }));
atlasRoiService.focus = async (_, roi) =>
  useViewStateStore.getState().setViewState((s) => {
    s.crosshair.world_mm = roi.worldMm!;
  });
histogramService.computeHistogram = async (request) => ({
  bins: [],
  minValue: 0,
  maxValue: 400,
  totalCount: 400,
  mean: 200,
  std: 100,
  binCount: 0,
  layerId: request.layerId,
});
parcelOverlayService.preview = async (request) => ({
  ...preview,
  bindingError: request.keyKind !== 'id'
    ? 'Invalid Input: Invalid data: ambiguous atlas key LabelHemisphere("OFC_1", Left)'
    : request.keyColumn === 'roi_id' ? null : 'Choose the parcel ID column',
});
parcelOverlayService.create = async (request, column, tableName) => {
  const info: ParcelOverlayInfo = {
    volumeId: 'overlay',
    sourceVolumeId: request.sourceVolumeId,
    tableName,
    selectedColumn: column,
    preview,
  };
  useLayerStore
    .getState()
    .addLayer({
      id: 'overlay',
      volumeId: 'overlay',
      name: `${tableName} · ${column}`,
      type: 'functional',
      visible: true,
      order: 1,
      parcelOverlay: info,
    });
  useViewStateStore.getState().setViewState((s) => {
    s.layers.push({
      id: 'overlay',
      volumeId: 'overlay',
      name: `${tableName} · ${column}`,
      visible: true,
      opacity: 1,
      colormap: 'viridis',
      intensity: [1, 400],
      threshold: [0, 0],
    });
  });
  useInspectorSelectionStore
    .getState()
    .setActive(buildSceneStack(useLayerStore.getState().layers, new Map(), null).volumes[1]);
};
parcelOverlayService.selectColumn = async (_, column) => {
  const info = useLayerStore.getState().layers.find((l) => l.id === 'overlay')!.parcelOverlay!;
  useLayerStore
    .getState()
    .updateLayer('overlay', { parcelOverlay: { ...info, selectedColumn: column } });
};
surfaceParcelOverlayService.preview = async (_, request) => parcelOverlayService.preview(request);
// Run the real surface create/column service against a compact backend receipt.
(surfaceParcelOverlayService as unknown as { transport: unknown }).transport = {
  invoke: async () =>
    ({
      preview,
      parcelIds: Array.from({ length: 400 }, (_, i) => i + 1),
      columns: Object.fromEntries(
        ['linear', 'quadratic', 'cubic'].map((name, i) => [
          name,
          Array.from({ length: 401 }, (_, code) => (code ? code ** (i + 1) : null)),
        ]),
      ),
    }) satisfies SurfaceParcelTable,
};
function Harness() {
  const crosshair = useViewStateStore((s) => s.viewState.crosshair.world_mm);
  const [metric, setMetric] = React.useState<'none' | 'variance' | 'mean'>('none');
  return (
    <main className="flex gap-8 p-6 bg-background text-foreground" style={{ minHeight: '100vh' }}>
      <aside className="w-64 text-sm space-y-3">
        <h1 className="text-xl">Parcel values & ROI navigation</h1>
        <p>Actual Inspector router · mocked atlas resources and IPC</p>
        <p>
          Crosshair: <output>{crosshair.join(', ')}</output>
        </p>
        <button onClick={selectVolume} className="underline">
          Select volume atlas
        </button>
        <details>
          <summary>Other shared controls</summary>
          <div className="space-y-3 py-3" data-testid="shared-controls">
            <TemporalMetricSelector value={metric} onChange={setMetric} />
            <Button variant="secondary" size="sm">Shared button</Button>
            <input aria-label="Shared file input" type="file" className="w-full text-xs" />
          </div>
        </details>
      </aside>
      <div style={{ width: 400, height: 'calc(100vh - 48px)' }} className="border border-border">
        <InspectorRouter />
      </div>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
