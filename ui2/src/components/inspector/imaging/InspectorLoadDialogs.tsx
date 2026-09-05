import React, { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { AtlasConfigModal } from '@/components/dialogs/AtlasConfigModal';
import { AtlasService } from '@/services/AtlasService';
import type { AtlasCatalogEntry } from '@/types/atlas';
import { useLayerStore } from '@/stores/layerStore';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { useVolToSurfProjection } from '@/hooks/useVolToSurfProjection';

export function AtlasPicker({ onClose }: { onClose: () => void }) {
  const [catalog, setCatalog] = useState<AtlasCatalogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AtlasCatalogEntry | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    AtlasService.getCatalog(controller.signal)
      .then((entries) => {
        if (!controller.signal.aborted)
          setCatalog(
            entries
              .map((entry) => ({
                ...entry,
                allowed_spaces: entry.allowed_spaces.filter(
                  (space) => space.data_type === 'Volume' || space.data_type === 'Both',
                ),
              }))
              .filter((entry) => entry.allowed_spaces.length > 0),
          );
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setError(String(error));
      });
    return () => controller.abort();
  }, []);
  if (selected) return <AtlasConfigModal isOpen atlas={selected} onClose={onClose} />;
  return (
    <Modal isOpen onClose={onClose} title="Load atlas" size="md">
      {error && <p role="alert">{error}</p>}
      {!catalog && !error && <p role="status">Loading atlas catalog…</p>}
      {catalog?.length === 0 && <p>No atlases are available.</p>}
      <div className="space-y-2">
        {catalog?.map((atlas) => (
          <button
            key={atlas.id}
            type="button"
            className="block w-full rounded border border-border p-3 text-left hover:bg-accent focus-visible:ring-2"
            onClick={() => setSelected(atlas)}
          >
            <span className="block font-medium">{atlas.name}</span>
            <span className="text-xs text-muted-foreground">{atlas.description}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function ProjectionPicker({ onClose }: { onClose: () => void }) {
  const layers = useLayerStore((state) => state.layers);
  const surfaces = useSurfaceStore((state) => state.surfaces);
  const { projectVolume, isProjecting, error } = useVolToSurfProjection();
  const [volumeId, setVolumeId] = useState('');
  const [surfaceId, setSurfaceId] = useState('');
  const volume = layers.find((layer) => layer.volumeId === volumeId);
  const surface = surfaces.get(surfaceId);
  const valid = Boolean(volume && surface);
  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Project volume to surface"
      size="sm"
      closeButtonDisabled={isProjecting}
      closeOnEscape={!isProjecting}
      closeOnOverlayClick={!isProjecting}
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Choose a volume and a surface in the same anatomical space.
        </p>
        <label className="block">
          Volume
          <select
            className="mt-1 block w-full rounded border bg-background p-2"
            value={volumeId}
            onChange={(event) => setVolumeId(event.target.value)}
            disabled={isProjecting}
          >
            <option value="">Select a volume</option>
            {layers.map((layer) => (
              <option key={layer.id} value={layer.volumeId}>
                {layer.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          Surface
          <select
            className="mt-1 block w-full rounded border bg-background p-2"
            value={surfaceId}
            onChange={(event) => setSurfaceId(event.target.value)}
            disabled={isProjecting}
          >
            <option value="">Select a surface</option>
            {Array.from(surfaces.values()).map((item) => (
              <option key={item.handle} value={item.handle}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {(!layers.length || !surfaces.size) && (
          <p role="status">Load a volume and surface first.</p>
        )}
        {error && <p role="alert">{error.message}</p>}
        <button
          type="button"
          disabled={!valid || isProjecting}
          className="rounded border border-border px-3 py-2 hover:bg-accent disabled:opacity-50"
          onClick={async () => {
            if (!volume || !surface) return;
            const result = await projectVolume(
              volumeId,
              surfaceId,
              `${volume.name} on ${surface.name}`,
            );
            if (result) onClose();
          }}
        >
          {isProjecting ? 'Projecting…' : 'Project'}
        </button>
      </div>
    </Modal>
  );
}
