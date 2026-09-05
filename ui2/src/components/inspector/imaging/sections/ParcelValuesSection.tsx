import React, { useState } from 'react';
import type { SceneItem } from '@/types/sceneItem';
import type { ParcelTablePreview } from '@brainflow/api';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { surfaceParcelOverlayService } from '@/services/SurfaceParcelOverlayService';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { parcelOverlayService } from '@/services/ParcelOverlayService';
import { ParcelTableImport, parcelError } from '@/components/atlas/ParcelTableImport';
import { InspectorSection } from '../InspectorSection';

/** The active Inspector owns the import action, including an atlas used as base. */
export function ParcelValuesSection({ item }: { item: SceneItem }) {
  const layerId = item.ref.type === 'volume' ? item.ref.layerId : null;
  const layer = useLayerStore((s) => s.layers.find((l) => l.id === layerId));
  const viewLayer = useViewStateStore((s) => s.viewState.layers.find((l) => l.id === layerId));
  const surfaces = useSurfaceStore((s) => s.surfaces);
  const surfaceRef = item.ref.type === 'surface-overlay' ? item.ref : null;
  const surfaceLayer = surfaceRef
    ? surfaces.get(surfaceRef.surfaceId)?.layers.get(surfaceRef.surfaceLayerId)
    : null;
  const [importing, setImporting] = useState(false);
  const overlay = layer?.parcelOverlay;
  const isAtlas = !!layer && !overlay && (layer.source === 'atlas' || !!viewLayer?.atlasConfig);
  if (
    surfaceLayer &&
    surfaceRef &&
    (surfaceLayer.parcelDictionaryId || surfaceLayer.parcelOverlay)
  ) {
    const info = surfaceLayer.parcelOverlay;
    return (
      <InspectorSection label="Parcel values" defaultOpen>
        {info ? (
          <ParcelColumnControl
            tableName={info.tableName}
            preview={info.table.preview}
            selectedColumn={info.selectedColumn}
            onSelect={(column) =>
              surfaceParcelOverlayService.selectColumn(
                surfaceRef.surfaceId,
                surfaceRef.surfaceLayerId,
                column,
              )
            }
          />
        ) : importing ? (
          <ParcelTableImport
            atlasName={surfaceLayer.name}
            surfaceTarget={{
              surfaceId: surfaceRef.surfaceId,
              layerId: surfaceRef.surfaceLayerId,
              dictionaryId: surfaceLayer.parcelDictionaryId!,
            }}
            onClose={() => setImporting(false)}
          />
        ) : (
          <div className="space-y-2 py-2">
            <button
              type="button"
              className="bf-button w-full rounded border border-border px-3 py-2 text-[12px] hover:bg-accent/40"
              onClick={() => setImporting(true)}
            >
              Add parcel values…
            </button>
            <p className="text-[11px] text-muted-foreground">
              Load a CSV or TSV with one value per ROI.
            </p>
          </div>
        )}
      </InspectorSection>
    );
  }
  if (!isAtlas && !overlay) return null;
  return (
    <InspectorSection label="Parcel values" defaultOpen>
      {overlay ? (
        <ParcelColumnControl
          tableName={overlay.tableName}
          preview={overlay.preview}
          selectedColumn={overlay.selectedColumn}
          onSelect={(column) => parcelOverlayService.selectColumn(layer!.id, column)}
        />
      ) : importing ? (
        <ParcelTableImport
          sourceVolumeId={layer!.volumeId}
          atlasName={layer!.name}
          onClose={() => setImporting(false)}
        />
      ) : (
        <div className="space-y-2 py-2">
          <button
            type="button"
            className="bf-button w-full rounded border border-border px-3 py-2 text-[12px] hover:bg-accent/40"
            onClick={() => setImporting(true)}
          >
            Add parcel values…
          </button>
          <p className="text-[11px] text-muted-foreground">
            Load a CSV or TSV with one value per ROI.
          </p>
        </div>
      )}
    </InspectorSection>
  );
}

export function ParcelColumnControl({
  tableName,
  preview,
  selectedColumn,
  onSelect,
}: {
  tableName: string;
  preview: ParcelTablePreview;
  selectedColumn: string;
  onSelect: (column: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const column = preview.columns.find((c) => c.name === selectedColumn);
  return (
    <div className="space-y-2 py-2 text-[12px]">
      <p className="break-words font-medium">{tableName}</p>
      <label className="block space-y-1">
        Display column
        <select
          className="bf-select w-full"
          disabled={busy}
          value={selectedColumn}
          onChange={async (e) => {
            setBusy(true);
            setError('');
            try {
              await onSelect(e.target.value);
            } catch (e) {
              setError(parcelError(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {preview.columns
            .filter((c) => !c.error && c.range)
            .map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
        </select>
      </label>
      <p className="text-muted-foreground">
        {preview.matchedParcels}/{preview.atlasParcels} parcels matched ·{' '}
        {column?.missingCount ?? 0} missing cells
      </p>
      <p className="text-[11px] text-muted-foreground">
        Changing columns resets intensity and threshold. Missing values are transparent.
      </p>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <details className="text-[11px] break-all">
        <summary className="cursor-pointer">Table binding</summary>
        <p>Atlas: {preview.atlasName}</p>
        <p>Dictionary SHA-256: {preview.dictionarySha256}</p>
        <p>Table SHA-256: {preview.tableSha256}</p>
      </details>
    </div>
  );
}
