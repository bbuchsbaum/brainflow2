/** Dev-only UI fixture. IPC is mocked; scientific/GPU evidence lives in Rust tests. */
import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ParcelOverlayInfo, ParcelTablePreview } from '@brainflow/api';
import { ParcelTableImport } from '@/components/atlas/ParcelTableImport';
import { ParcelOverlayInspector } from '@/components/atlas/ParcelOverlayInspector';
import { parcelOverlayService } from '@/services/ParcelOverlayService';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import '@/index.css';

const preview: ParcelTablePreview = {
  atlasName: 'Schaefer 400 · 7 networks · MNI152 · 2 mm',
  atlasParcels: 400,
  headers: ['roi_id', 'beta', 't_stat', 'p_value'],
  rowCount: 400,
  matchedParcels: 400,
  missingParcels: 0,
  bindingError: null,
  columns: [
    { name: 'beta', range: [-2.4, 3.1], finiteCount: 398, missingCount: 2, error: null },
    { name: 't_stat', range: [-5.6, 6.2], finiteCount: 398, missingCount: 2, error: null },
    { name: 'p_value', range: [0.001, 0.98], finiteCount: 398, missingCount: 2, error: null },
  ],
  keyExamples: [
    '1 · 7Networks_LH_Vis_1 · left',
    '2 · 7Networks_LH_Vis_2 · left',
    '3 · 7Networks_LH_Vis_3 · left',
  ],
  dictionarySha256: 'd'.repeat(64),
  tableSha256: 'a'.repeat(64),
};
const info: ParcelOverlayInfo = {
  volumeId: 'overlay',
  sourceVolumeId: 'atlas',
  tableName: 'group_statistics.csv',
  selectedColumn: 'beta',
  preview,
};
useLayerStore
  .getState()
  .addLayer({
    id: 'overlay',
    volumeId: 'overlay',
    name: 'group statistics · beta',
    type: 'functional',
    visible: true,
    order: 1,
    parcelOverlay: info,
  });
useViewStateStore.getState().setViewState((s) => {
  s.layers = [
    {
      id: 'overlay',
      volumeId: 'overlay',
      name: 'group statistics · beta',
      visible: true,
      opacity: 0.8,
      colormap: 'fmri',
      intensity: [-3.1, 3.1],
      threshold: [0, 0],
    },
  ];
});
parcelOverlayService.preview = async (request) => ({
  ...preview,
  bindingError:
    request.keyColumn === 'roi_id' ? null : 'Choose the parcel ID column for this fixture',
});
parcelOverlayService.create = async () => {};
parcelOverlayService.selectColumn = async (_, column) => {
  useLayerStore
    .getState()
    .updateLayer('overlay', { parcelOverlay: { ...info, selectedColumn: column } });
};
function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <main style={{ maxWidth: 920, margin: '32px auto', padding: 16 }}>
      <h1 className="text-xl mb-2">Parcel table overlay</h1>
      <p className="text-xs text-muted-foreground mb-6">
        UI fixture · IPC mocked · separate import and overlay inspector
      </p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          gap: 24,
          alignItems: 'start',
        }}
      >
        <div>
          {open && (
            <ParcelTableImport
              sourceVolumeId="atlas"
              atlasName={preview.atlasName}
              onClose={() => setOpen(false)}
            />
          )}
        </div>
        <div className="rounded border border-border">
          <ParcelOverlayInspector layerId="overlay" />
        </div>
      </div>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
