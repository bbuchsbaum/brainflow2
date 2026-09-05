import React, { useEffect, useState } from 'react';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { parcelOverlayService } from '@/services/ParcelOverlayService';
import { useLayerRenderUpdater } from '../panels/inspectorAnnotatePanel.helpers';
import { EnhancedColormapSelector } from '../panels/EnhancedColormapSelector';
import { SingleSlider } from '../ui/SingleSlider';
import { parcelError } from './ParcelTableImport';

function Limits({
  label,
  value,
  onChange,
}: {
  label: string;
  value: [number, number];
  onChange: (v: [number, number]) => void;
}) {
  const [low, setLow] = useState(String(value[0]));
  const [high, setHigh] = useState(String(value[1]));
  useEffect(() => {
    setLow(String(value[0]));
    setHigh(String(value[1]));
  }, [value[0], value[1]]);
  const valid =
    low.trim() !== '' &&
    high.trim() !== '' &&
    Number.isFinite(Number(low)) &&
    Number.isFinite(Number(high)) &&
    Number(low) < Number(high) &&
    Math.max(Math.abs(Number(low)), Math.abs(Number(high))) <= 3.4028234663852886e38;
  return (
    <fieldset className="space-y-1">
      <legend className="text-xs">{label}</legend>
      <div className="flex gap-2">
        <input
          aria-label={`${label} minimum`}
          type="number"
          step="any"
          className="w-1/2 min-w-0 rounded border border-border bg-background px-2 py-1 text-sm"
          value={low}
          onChange={(e) => setLow(e.target.value)}
        />
        <input
          aria-label={`${label} maximum`}
          type="number"
          step="any"
          className="w-1/2 min-w-0 rounded border border-border bg-background px-2 py-1 text-sm"
          value={high}
          onChange={(e) => setHigh(e.target.value)}
        />
      </div>
      <button
        className="text-xs underline disabled:opacity-40"
        disabled={!valid || (Number(low) === value[0] && Number(high) === value[1])}
        onClick={() => onChange([Number(low), Number(high)])}
      >
        Apply {label.toLowerCase()}
      </button>
    </fieldset>
  );
}

export function ParcelOverlayInspector({ layerId }: { layerId: string }) {
  const info = useLayerStore((s) => s.layers.find((l) => l.id === layerId)?.parcelOverlay);
  const view = useViewStateStore((s) => s.viewState.layers.find((l) => l.id === layerId));
  const update = useLayerRenderUpdater(layerId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!info || !view) return null;
  const column = info.preview.columns.find((c) => c.name === info.selectedColumn);
  return (
    <section aria-label="Parcel overlay controls" className="p-3 space-y-4">
      <div>
        <p className="text-sm font-medium break-words">{info.tableName}</p>
        <p className="text-xs text-muted-foreground">
          {info.preview.atlasName} · {info.preview.matchedParcels}/{info.preview.atlasParcels}{' '}
          parcels
        </p>
      </div>
      <label className="block space-y-1 text-sm">
        Display column
        <select
          className="w-full rounded border border-border bg-background p-2 text-sm"
          disabled={busy}
          value={info.selectedColumn}
          onChange={async (e) => {
            setBusy(true);
            setError('');
            try {
              await parcelOverlayService.selectColumn(layerId, e.target.value);
            } catch (e) {
              setError(parcelError(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {info.preview.columns
            .filter((c) => !c.error)
            .map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
        </select>
      </label>
      {column?.range && (
        <p className="text-xs text-muted-foreground">
          {column.finiteCount} values · range {column.range[0]} to {column.range[1]} ·{' '}
          {column.missingCount + info.preview.missingParcels} missing parcels
        </p>
      )}
      <EnhancedColormapSelector
        value={view.colormap}
        onChange={(colormap) => update({ colormap })}
      />
      <Limits
        label="Color limits"
        value={view.intensity}
        onChange={(intensity) => update({ intensity })}
      />
      <SingleSlider
        label="Opacity"
        min={0}
        max={1}
        value={view.opacity}
        onChange={(opacity) => update({ opacity })}
        showPercentage
        layout="strip"
        compact
        highContrast
      />
      <Limits
        label="Hide values between"
        value={view.threshold}
        onChange={(threshold) => update({ threshold })}
      />
      <button className="text-xs underline" onClick={() => update({ threshold: [0, 0] })}>
        Clear threshold
      </button>
      <p className="text-xs text-muted-foreground">
        Column changes reset color limits and thresholds. Missing parcels are transparent.
      </p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <details className="text-xs break-all">
        <summary className="cursor-pointer">Table binding</summary>
        <p className="mt-2">Dictionary SHA-256: {info.preview.dictionarySha256}</p>
        <p className="mt-2">Table SHA-256: {info.preview.tableSha256}</p>
        <p className="mt-2">
          Keys match the selected atlas. A CSV does not establish the source of the statistics.
        </p>
      </details>
    </section>
  );
}
