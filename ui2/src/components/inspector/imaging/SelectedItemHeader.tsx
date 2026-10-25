import React from 'react';
import type { SceneItem, SceneItemKind } from '@/types/sceneItem';

interface SelectedItemHeaderProps {
  item: SceneItem;
}

// Kind tags are neutral chips: the item kind is chrome, not data, so it does
// not get its own hue (the amber accent is reserved for selection/active).
const KIND_TAG: Record<SceneItemKind, string> = {
  'volume-base': 'Base',
  'volume-overlay': 'Volume',
  'volume-overlay-atlas': 'Atlas',
  'surface-geometry': 'Surface',
  'surface-overlay': 'Overlay',
  mapping: 'Mapping',
};

export function SelectedItemHeader({ item }: SelectedItemHeaderProps) {
  const tag = KIND_TAG[item.kind];
  return (
    <header className="border-y border-border/60 bg-card/40 px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-bf-2xs font-semibold text-muted-foreground">
            Selected
          </div>
          <div className="mt-0.5 truncate text-bf-lg font-semibold text-foreground" title={item.name}>
            {item.name}
          </div>
          <div className="mt-0.5 truncate text-bf-xs text-muted-foreground" title={item.subtitle}>
            {item.subtitle}
          </div>
        </div>
        <span
          className="inline-flex shrink-0 items-center rounded-sm border border-border bg-background px-2 py-0.5 text-bf-2xs font-semibold text-bf-text-secondary"
        >
          {tag}
        </span>
      </div>
    </header>
  );
}
