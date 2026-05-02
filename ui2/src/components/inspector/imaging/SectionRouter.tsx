import React from 'react';
import type { SceneItem } from '@/types/sceneItem';
import { RenderSection } from './sections/RenderSection';
import { DataSection } from './sections/DataSection';
import { GeometrySection } from './sections/GeometrySection';
import { MappingSection } from './sections/MappingSection';
import { ViewBehaviorSection } from './sections/ViewBehaviorSection';
import { AdvancedSection } from './sections/AdvancedSection';

/**
 * Picks which sections to render for the active scene item.
 *
 *   volume-base          → Render · Data · ViewBehavior · Advanced
 *   volume-overlay       → Render · Data · Mapping (when projected) · Advanced
 *   volume-overlay-atlas → Render (categorical) · Data · Advanced
 *   surface-geometry     → Render · Data · Geometry · Advanced
 *   surface-overlay      → Render · Data · Mapping (when from volume) · Advanced
 *   mapping              → Mapping · Advanced
 */
export function SectionRouter({ item }: { item: SceneItem }) {
  switch (item.kind) {
    case 'volume-base':
      return (
        <>
          <RenderSection item={item} />
          <DataSection item={item} />
          <ViewBehaviorSection item={item} />
          <AdvancedSection item={item} />
        </>
      );
    case 'volume-overlay':
      return (
        <>
          <RenderSection item={item} />
          <DataSection item={item} />
          <MappingSection item={item} />
          <AdvancedSection item={item} />
        </>
      );
    case 'volume-overlay-atlas':
      return (
        <>
          <RenderSection item={item} />
          <DataSection item={item} />
          <AdvancedSection item={item} />
        </>
      );
    case 'surface-geometry':
      return (
        <>
          <RenderSection item={item} />
          <DataSection item={item} />
          <GeometrySection item={item} />
          <AdvancedSection item={item} />
        </>
      );
    case 'surface-overlay':
      return (
        <>
          <RenderSection item={item} />
          <DataSection item={item} />
          <MappingSection item={item} />
          <AdvancedSection item={item} />
        </>
      );
    case 'mapping':
      return (
        <>
          <MappingSection item={item} />
          <AdvancedSection item={item} />
        </>
      );
    default:
      return null;
  }
}
