/**
 * LayerStatusBar - Technical status messages for LayerPanel
 * Bauhaus Instrument Control aesthetic
 */

import React from 'react';

interface LayerStatusBarProps {
  error?: string | null;
  isInitializing?: boolean;
}

export const LayerStatusBar: React.FC<LayerStatusBarProps> = ({
  error,
  isInitializing
}) => {
  if (error) {
    return (
      <div
        className="flex items-center gap-2 px-3 py-2 mb-2"
        style={{
          border: '1px solid hsl(var(--destructive) / 0.3)',
          backgroundColor: 'hsl(var(--destructive) / 0.1)',
          borderRadius: '1px'
        }}
      >
        <div
          className="w-2 h-2 shrink-0"
          style={{ backgroundColor: 'hsl(var(--destructive))', borderRadius: '1px' }}
        />
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-[0.15em] font-bold text-destructive">
            Error
          </div>
          <div className="text-[10px] font-mono text-destructive/80 truncate">
            {error}
          </div>
        </div>
      </div>
    );
  }

  if (isInitializing) {
    return (
      <div
        className="flex items-center gap-2 px-3 py-2 mb-2"
        style={{
          border: '1px solid hsl(var(--primary) / 0.3)',
          backgroundColor: 'hsl(var(--primary) / 0.1)',
          borderRadius: '1px'
        }}
      >
        <div
          className="w-2 h-2 shrink-0 animate-pulse"
          style={{ backgroundColor: 'hsl(var(--primary))', borderRadius: '1px' }}
        />
        <span className="text-[9px] uppercase tracking-[0.15em] font-mono text-primary">
          Initializing...
        </span>
      </div>
    );
  }

  return null;
};
