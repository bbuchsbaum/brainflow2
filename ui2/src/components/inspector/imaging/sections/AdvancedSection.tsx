import React from 'react';
import type { SceneItem } from '@/types/sceneItem';
import { Notice, Section } from '@/components/ui/bf';

interface AdvancedSectionProps {
  item: SceneItem;
}

/**
 * Power-user flags. Empty placeholder — collapsed by default — so the
 * grammar exposes the section without surfacing rarely-used controls.
 */
export function AdvancedSection({ item: _item }: AdvancedSectionProps) {
  return (
    <Section title="Advanced" icon={<GearIcon />} defaultOpen={false}>
      <Notice role={undefined}>No advanced settings yet for this item kind.</Notice>
    </Section>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" strokeLinecap="round" />
    </svg>
  );
}
