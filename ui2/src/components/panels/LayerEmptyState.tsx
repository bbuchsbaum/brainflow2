/**
 * LayerEmptyState - Bauhaus empty state component for LayerPanel
 * The "Empty Slot" pattern - quiet structural void
 */

import React from 'react';

interface LayerEmptyStateProps {
  onRefresh?: () => void;
  showRefreshButton?: boolean;
}

export const LayerEmptyState: React.FC<LayerEmptyStateProps> = ({
  onRefresh,
  showRefreshButton = false
}) => {
  return (
    <div className="h-full flex flex-col items-center justify-center p-6 text-center select-none">
      {/* Dashed boundary - the "empty slot" container */}
      <div
        className="w-full aspect-[4/3] max-h-[200px] flex flex-col items-center justify-center"
        style={{
          border: '1px dashed hsl(var(--muted-foreground) / 0.15)',
          backgroundColor: 'hsl(var(--background) / 0.5)',
          borderRadius: '1px'
        }}
      >
        {/* Geometric stack icon - abstract layers */}
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.75"
          strokeLinecap="square"
          strokeLinejoin="miter"
          className="text-muted-foreground/25 mb-3"
        >
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>

        {/* Technical status */}
        <span className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-[0.2em]">
          Layer Stack Empty
        </span>
      </div>

      {/* Subtle footer instruction */}
      <p className="mt-4 text-[9px] text-muted-foreground/40 max-w-[160px] leading-relaxed font-mono uppercase tracking-wider">
        Import volumes via File Browser
      </p>

      {showRefreshButton && onRefresh && (
        <button
          onClick={onRefresh}
          className="mt-3 px-3 py-1 text-[9px] uppercase tracking-wider font-mono border transition-colors pointer-events-auto"
          style={{
            borderColor: 'hsl(var(--border))',
            color: 'hsl(var(--muted-foreground))',
            backgroundColor: 'transparent',
            borderRadius: '1px'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'hsl(var(--muted) / 0.3)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
        >
          Refresh
        </button>
      )}
    </div>
  );
};