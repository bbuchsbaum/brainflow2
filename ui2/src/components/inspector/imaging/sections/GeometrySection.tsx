import React from 'react';
import type { SceneItem } from '@/types/sceneItem';
import { InspectorSection, FieldRow } from '../InspectorSection';

interface GeometrySectionProps {
  item: SceneItem;
}

/**
 * Surface-only section: lighting preset, material, smoothing, wireframe,
 * normals. Purely a thin chrome layer around the existing surface settings —
 * actual mutation hooks into surface display settings (deferred wire-up;
 * read-only labels until the new bridge is decided).
 */
export function GeometrySection({ item }: GeometrySectionProps) {
  if (item.kind !== 'surface-geometry') return null;

  return (
    <InspectorSection label="Geometry" icon={<GeometryIcon />} defaultOpen>
      <FieldRow label="Lighting preset">
        <span className="text-[12px] text-foreground">Clinical</span>
      </FieldRow>
      <FieldRow label="Material">
        <span className="text-[12px] text-foreground">Gray glossy</span>
      </FieldRow>
      <FieldRow label="Smoothing">
        <ReadOnlyMm value={0} />
      </FieldRow>
      <FieldRow label="Wireframe">
        <span className="text-[12px] text-muted-foreground">off</span>
      </FieldRow>
      <FieldRow label="Normals">
        <span className="text-[12px] text-sky-600 dark:text-sky-300">recalculate</span>
      </FieldRow>
    </InspectorSection>
  );
}

function ReadOnlyMm({ value }: { value: number }) {
  return (
    <span
      className="font-mono text-[12px] tabular-nums text-foreground"
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {value.toFixed(0)}%
    </span>
  );
}

function GeometryIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M3 12l5-9 5 9M5 12h6" strokeLinejoin="round" />
    </svg>
  );
}
