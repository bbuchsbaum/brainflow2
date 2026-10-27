import React from 'react';
import type { SceneItem } from '@/types/sceneItem';
import { KeyValue, Section } from '@/components/ui/bf';

interface ViewBehaviorSectionProps {
  item: SceneItem;
}

/**
 * Volume base only. Read-only display of orientation markers / hover
 * sampling / slice border for now; toggles will route through the existing
 * crosshair / hover settings stores in a follow-up.
 */
export function ViewBehaviorSection({ item }: ViewBehaviorSectionProps) {
  if (item.kind !== 'volume-base') return null;

  return (
    <Section title="View behavior" icon={<EyeIcon />} defaultOpen={false}>
      <KeyValue
        layout="rows"
        labelWidth="wide"
        items={[
          { label: 'Orientation markers', value: 'on', mono: false },
          { label: 'Hover sampling', value: 'on', mono: false },
          { label: 'Slice border', value: 'off', mono: false },
        ]}
      />
    </Section>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  );
}
