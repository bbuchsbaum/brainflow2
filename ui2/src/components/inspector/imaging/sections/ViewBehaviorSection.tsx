import React from 'react';
import type { SceneItem } from '@/types/sceneItem';
import { InspectorSection, FieldRow } from '../InspectorSection';

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
    <InspectorSection label="View Behavior" icon={<EyeIcon />} defaultOpen={false}>
      <FieldRow label="Orientation markers">
        <span className="text-[12px] text-muted-foreground">on</span>
      </FieldRow>
      <FieldRow label="Hover sampling">
        <span className="text-[12px] text-muted-foreground">on</span>
      </FieldRow>
      <FieldRow label="Slice border">
        <span className="text-[12px] text-muted-foreground">off</span>
      </FieldRow>
    </InspectorSection>
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
