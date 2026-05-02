import React from 'react';
import type { SceneItem, SceneItemKind } from '@/types/sceneItem';

interface SceneStackItemProps {
  item: SceneItem;
  selected: boolean;
  onSelect: () => void;
}

const KIND_GLYPH: Record<SceneItemKind, { letter: string; color: string }> = {
  'volume-base': { letter: 'V', color: 'sky' },
  'volume-overlay': { letter: 'O', color: 'amber' },
  'volume-overlay-atlas': { letter: 'L', color: 'violet' },
  'surface-geometry': { letter: 'S', color: 'emerald' },
  'surface-overlay': { letter: 'O', color: 'amber' },
  mapping: { letter: '↦', color: 'violet' },
};

const COLOR_TEXT: Record<string, string> = {
  sky: 'text-sky-700 dark:text-sky-200',
  amber: 'text-amber-700 dark:text-amber-200',
  violet: 'text-violet-700 dark:text-violet-200',
  emerald: 'text-emerald-700 dark:text-emerald-200',
};

const COLOR_BG: Record<string, string> = {
  sky: 'bg-sky-500/15',
  amber: 'bg-amber-500/15',
  violet: 'bg-violet-500/15',
  emerald: 'bg-emerald-500/15',
};

const COLOR_BORDER: Record<string, string> = {
  sky: 'border-sky-500/50',
  amber: 'border-amber-500/40',
  violet: 'border-violet-500/40',
  emerald: 'border-emerald-500/40',
};

export function SceneStackItem({ item, selected, onSelect }: SceneStackItemProps) {
  const glyph = KIND_GLYPH[item.kind];
  const colorClass = COLOR_TEXT[glyph.color] ?? '';
  const bgClass = COLOR_BG[glyph.color] ?? '';
  const borderClass = COLOR_BORDER[glyph.color] ?? '';
  const opacityPct = Math.round(item.opacity * 100);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`group flex w-full items-center gap-2.5 rounded-md border px-2 py-1.5 text-left transition-colors ${
        selected
          ? `${borderClass} bg-card`
          : 'border-transparent hover:bg-accent/30'
      }`}
    >
      <span
        aria-hidden
        className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${bgClass} ${colorClass}`}
      >
        {glyph.letter}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-[12px] font-medium ${
            selected ? colorClass : 'text-foreground'
          }`}
        >
          {item.name}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {item.subtitle}
        </span>
      </span>
      <span
        className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {opacityPct}%
      </span>
    </button>
  );
}
