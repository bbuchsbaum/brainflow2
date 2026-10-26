/**
 * TooltipOverlay - Global hover tooltip overlay for slice and mosaic views.
 *
 * Subscribes to useTooltipStore and renders a small panel near the mouse
 * position with generic entries (coord, intensity, atlas-region, etc.).
 */

import React, { useMemo } from 'react';
import { useTooltipStore } from '@/stores/tooltipStore';
import { formatWorldMm } from '@/utils/valueFormat';

export const TooltipOverlay: React.FC = () => {
  const tooltip = useTooltipStore(state => state.tooltip);

  const content = useMemo(() => {
    if (!tooltip) return null;
    const { entries, world } = tooltip;
    // One position line (U+2212 minus): the coordinates provider's "World"
    // entry repeats it, so it is dropped.
    const coordLabel = `(${world.map((v) => formatWorldMm(v)).join(', ')}) mm`;
    const otherEntries = entries.filter((e) => e.kind !== 'coord' && e.label !== 'World');
    return { coordLabel, otherEntries };
  }, [tooltip]);

  if (!tooltip || !content) {
    return null;
  }

  const { screen } = tooltip;
  const { coordLabel, otherEntries } = content;

  const left = screen.x + 12;
  const top = screen.y + 12;

  return (
    <div
      style={{
        position: 'fixed',
        left,
        top,
        zIndex: 1000,
        pointerEvents: 'none',
        maxWidth: 260,
      }}
    >
      <div
        className="rounded-sm shadow-lg text-bf-xs"
        style={{
          backgroundColor: 'hsl(var(--popover) / 0.96)',
          color: 'var(--bf-text-primary)',
          border: '1px solid var(--bf-border)',
          padding: '6px 8px',
        }}
      >
        <div style={{ marginBottom: otherEntries.length ? 4 : 0 }}>
          <span className="font-mono tabular-nums">{coordLabel}</span>
        </div>
        {otherEntries.map((entry, idx) => (
          <div key={`${entry.kind}-${idx}`}>
            <span style={{ opacity: 0.75 }}>
              {entry.kind === 'atlas-region'
                ? 'Atlas:'
                : entry.kind === 'intensity'
                ? 'Intensity:'
                : entry.label}
            </span>{' '}
            {entry.kind === 'atlas-region' ? (
              <span>{entry.label}</span>
            ) : (
              <span>{entry.value ?? entry.label}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

