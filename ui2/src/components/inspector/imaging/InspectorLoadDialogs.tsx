import React, { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { AtlasConfigModal } from '@/components/dialogs/AtlasConfigModal';
import { AtlasService } from '@/services/AtlasService';
import type { AtlasCatalogEntry } from '@/types/atlas';
import { useLayerStore } from '@/stores/layerStore';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { useVolToSurfProjection } from '@/hooks/useVolToSurfProjection';
import { Button, FieldRow, Notice, SelectableRow, Select } from '@/components/ui/bf';
import { formatTauriError } from '@/utils/formatTauriError';

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
        if (!controller.signal.aborted) setError(formatTauriError(error));
      });
    return () => controller.abort();
  }, []);
  if (selected) return <AtlasConfigModal isOpen atlas={selected} onClose={onClose} />;
  return (
    <Modal isOpen onClose={onClose} title="Load atlas" size="md">
      {error && (
        <Notice severity="danger" role="alert">
          {error}
        </Notice>
      )}
      {!catalog && !error && <Notice>Loading atlas catalog…</Notice>}
      {catalog?.length === 0 && <Notice role={undefined}>No atlases are available.</Notice>}
      <div className="space-y-2">
        {catalog?.map((atlas) => (
          <SelectableRow
            key={atlas.id}
            variant="card"
            role="button"
            onSelect={() => setSelected(atlas)}
          >
            <span className="block text-bf-sm font-medium text-foreground">{atlas.name}</span>
            <span className="text-bf-xs text-muted-foreground">{atlas.description}</span>
          </SelectableRow>
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
        <p className="text-bf-sm text-muted-foreground">
          Choose a volume and a surface in the same anatomical space.
        </p>
        <FieldRow label="Volume" layout="stacked">
          <Select
            value={volumeId}
            onValueChange={setVolumeId}
            disabled={isProjecting}
          >
            <option value="">Select a volume</option>
            {layers.map((layer) => (
              <option key={layer.id} value={layer.volumeId}>
                {layer.name}
              </option>
            ))}
          </Select>
        </FieldRow>
        <FieldRow label="Surface" layout="stacked">
          <Select
            value={surfaceId}
            onValueChange={setSurfaceId}
            disabled={isProjecting}
          >
            <option value="">Select a surface</option>
            {Array.from(surfaces.values()).map((item) => (
              <option key={item.handle} value={item.handle}>
                {item.name}
              </option>
            ))}
          </Select>
        </FieldRow>
        {(!layers.length || !surfaces.size) && (
          <Notice>Load a volume and surface first.</Notice>
        )}
        {error && (
          <Notice severity="danger" role="alert">
            {error.message}
          </Notice>
        )}
        <Button
          variant="primary"
          size="sm"
          disabled={!valid || isProjecting}
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
        </Button>
      </div>
    </Modal>
  );
}
