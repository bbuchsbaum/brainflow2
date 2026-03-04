/**
 * TooltipOverlay - Global hover tooltip overlay for slice and mosaic views.
 *
 * Subscribes to useTooltipStore and renders a small panel near the mouse
 * position with generic entries (coord, intensity, atlas-region, etc.).
 */

import React, { useMemo } from 'react';
import { useTooltipStore } from '@/stores/tooltipStore';

export const TooltipOverlay: React.FC = () => {
  const tooltip = useTooltipStore(state => state.tooltip);

  const content = useMemo(() => {
    if (!tooltip) return null;
    const { entries, world } = tooltip;

    const coordEntry = entries.find(e => e.kind === 'coord');
    const otherEntries = entries.filter(e => e.kind !== 'coord');

    const coordLabel =
      coordEntry?.value ??
      `(${world[0].toFixed(1)}, ${world[1].toFixed(1)}, ${world[2].toFixed(1)})`;

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
        className="rounded-md shadow-lg text-xs"
        style={{
          backgroundColor: 'rgba(17, 24, 39, 0.94)', // gray-900 with alpha
          color: '#e5e7eb', // gray-200
          border: '1px solid rgba(55, 65, 81, 0.9)', // gray-700
          padding: '6px 8px',
        }}
      >
        <div style={{ marginBottom: otherEntries.length ? 4 : 0 }}>
          <span style={{ opacity: 0.75 }}>Coord:</span>{' '}
          <span style={{ fontFamily: 'monospace' }}>{coordLabel}</span>
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

