import React from 'react';
import { useLayerStore } from '@/stores/layerStore';
import { useSurfaceStore } from '@/stores/surfaceStore';
import type { SceneItem } from '@/types/sceneItem';
import { InspectorSection, FieldRow } from '../InspectorSection';

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
  if (item.ref.type !== 'mapping' && item.ref.type !== 'surface-overlay') return null;

  const surfaces = useSurfaceStore((s) => s.surfaces);
  const volumeLayers = useLayerStore((s) => s.layers);

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
      <InspectorSection label="Mapping" icon={<MappingIcon />} defaultOpen>
        <FieldRow label="Source">
          <span className="truncate text-[12px] text-foreground" title={sourceVolume?.name ?? volumeId}>
            {sourceVolume?.name ?? volumeId}
          </span>
        </FieldRow>
        <FieldRow label="Target">
          <span className="truncate text-[12px] text-foreground" title={surface.name}>
            {surface.name}
          </span>
        </FieldRow>
        <FieldRow label="Method">
          <span className="text-[12px] capitalize text-foreground">{method}</span>
        </FieldRow>
        <FieldRow label="Sample radius">
          <span
            className="font-mono text-[12px] tabular-nums text-foreground"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {sampleRadius != null ? `${sampleRadius.toFixed(1)} mm` : '—'}
          </span>
        </FieldRow>
        <FieldRow label="Surface smoothing">
          <span
            className="font-mono text-[12px] tabular-nums text-foreground"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {smoothingKernel != null ? `${smoothingKernel.toFixed(1)} mm` : '—'}
          </span>
        </FieldRow>
        <FieldRow label="Status">
          <span className="text-[11px] text-emerald-600 dark:text-emerald-300">current</span>
        </FieldRow>
        <div className="mt-2 flex items-center justify-between border-t border-border/40 pt-2 text-[11px]">
          <span className="text-muted-foreground">Action</span>
          <button
            type="button"
            className="rounded-md border border-border bg-background px-2 py-0.5 text-[11px] text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            Recompute projection
          </button>
        </div>
      </InspectorSection>

      <InspectorSection label="Linked Display" icon={<LinkIcon />} defaultOpen={false}>
        <FieldRow label="Sync colormap">
          <span className="text-[12px] text-muted-foreground">on</span>
        </FieldRow>
        <FieldRow label="Sync threshold">
          <span className="text-[12px] text-muted-foreground">on</span>
        </FieldRow>
        <FieldRow label="Volume opacity">
          <span
            className="font-mono text-[12px] tabular-nums text-foreground"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            85%
          </span>
        </FieldRow>
        <FieldRow label="Surface opacity">
          <span
            className="font-mono text-[12px] tabular-nums text-foreground"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            70%
          </span>
        </FieldRow>
      </InspectorSection>
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
