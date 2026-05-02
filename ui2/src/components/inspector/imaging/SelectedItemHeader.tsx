import React from 'react';
import type { SceneItem, SceneItemKind } from '@/types/sceneItem';

interface SelectedItemHeaderProps {
  item: SceneItem;
}

const KIND_TAG: Record<SceneItemKind, { label: string; tone: 'sky' | 'emerald' | 'violet' | 'amber' | 'neutral' }> = {
  'volume-base': { label: 'BASE', tone: 'neutral' },
  'volume-overlay': { label: 'VOLUME', tone: 'sky' },
  'volume-overlay-atlas': { label: 'ATLAS', tone: 'violet' },
  'surface-geometry': { label: 'SURFACE', tone: 'emerald' },
  'surface-overlay': { label: 'OVERLAY', tone: 'amber' },
  mapping: { label: 'MAPPING', tone: 'violet' },
};

const TONE_CLASS: Record<string, string> = {
  sky: 'border-sky-500/40 text-sky-700 dark:text-sky-200',
  emerald: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-200',
  violet: 'border-violet-500/40 text-violet-700 dark:text-violet-200',
  amber: 'border-amber-500/40 text-amber-700 dark:text-amber-200',
  neutral: 'border-border text-muted-foreground',
};

export function SelectedItemHeader({ item }: SelectedItemHeaderProps) {
  const tag = KIND_TAG[item.kind];
  return (
    <header className="border-y border-border/60 bg-card/40 px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">
            Selected
          </div>
          <div className="mt-0.5 truncate text-[14px] font-semibold text-foreground" title={item.name}>
            {item.name}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground" title={item.subtitle}>
            {item.subtitle}
          </div>
        </div>
        <span
          className={`inline-flex shrink-0 items-center rounded-md border bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${TONE_CLASS[tag.tone]}`}
        >
          {tag.label}
        </span>
      </div>
    </header>
  );
}
