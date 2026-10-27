import React from 'react';
import { useLayerStore } from '@/stores/layerStore';
import { useSurfaceStore } from '@/stores/surfaceStore';
import type { SceneItem } from '@/types/sceneItem';
import { Button, KeyValue, Section, StatusPill } from '@/components/ui/bf';

interface MappingSectionProps {
  item: SceneItem;
}

/**
 * Volume-to-surface mapping section. Shown when a `mapping` scene item is
 * selected, OR when a `surface-overlay` with a `volumeId` is selected.
 * Includes a Linked Display sub-block that pairs colormap / threshold /
 * opacities across the volume and the surface overlay so the same finding
 * looks identical on both supports.
 */
export function MappingSection({ item }: MappingSectionProps) {
  // Hooks first: their order must not depend on the item kind.
  const surfaces = useSurfaceStore((s) => s.surfaces);
  const volumeLayers = useLayerStore((s) => s.layers);
  if (item.ref.type !== 'mapping' && item.ref.type !== 'surface-overlay') return null;

  const surfaceId = item.ref.surfaceId;
  const surfaceLayerId = item.ref.surfaceLayerId;
  const surface = surfaces.get(surfaceId);
  const surfaceLayer = surface?.layers.get(surfaceLayerId);
  const volumeId =
    item.ref.type === 'mapping' ? item.ref.volumeId : surfaceLayer?.volumeId ?? null;
  const sourceVolume = volumeId
    ? volumeLayers.find((l) => l.id === volumeId) ?? null
    : null;
  if (!surface || !surfaceLayer || !volumeId) return null;

  const method = surface.metadata.mappingOptions?.method ?? 'projection';
  const sampleRadius = surface.metadata.mappingOptions?.projectionDepth ?? null;
  const smoothingKernel = surface.metadata.mappingOptions?.smoothingKernel ?? null;

  return (
    <>
      <Section title="Mapping" icon={<MappingIcon />} defaultOpen>
        <KeyValue
          layout="rows"
          labelWidth="wide"
          items={[
            { label: 'Source', value: sourceVolume?.name ?? volumeId },
            { label: 'Target', value: surface.name },
            { label: 'Method', value: method.charAt(0).toUpperCase() + method.slice(1), mono: false },
            {
              label: 'Sample radius',
              value: sampleRadius != null ? `${sampleRadius.toFixed(1)} mm` : '—',
            },
            {
              label: 'Surface smoothing',
              value: smoothingKernel != null ? `${smoothingKernel.toFixed(1)} mm` : '—',
            },
            { label: 'Status', value: <StatusPill status="success">Current</StatusPill>, mono: false },
          ]}
        />
        <div className="mt-2 flex items-center justify-between border-t border-bf-border-subtle pt-2 text-bf-xs">
          <span className="text-muted-foreground">Action</span>
          <Button variant="secondary" size="sm">
            Recompute projection
          </Button>
        </div>
      </Section>

      <Section title="Linked display" icon={<LinkIcon />} defaultOpen={false}>
        <KeyValue
          layout="rows"
          labelWidth="wide"
          items={[
            { label: 'Sync colormap', value: 'on', mono: false },
            { label: 'Sync threshold', value: 'on', mono: false },
            { label: 'Volume opacity', value: '85%' },
            { label: 'Surface opacity', value: '70%' },
          ]}
        />
      </Section>
    </>
  );
}

function MappingIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M3 8h7M7 5l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="13" cy="8" r="1.4" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M6 10a3 3 0 010-4l2-2a3 3 0 014 4l-1 1" strokeLinecap="round" />
      <path d="M10 6a3 3 0 010 4l-2 2a3 3 0 01-4-4l1-1" strokeLinecap="round" />
    </svg>
  );
}
