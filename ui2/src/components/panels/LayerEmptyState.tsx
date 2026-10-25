/**
 * LayerEmptyState - Bauhaus empty state component for LayerPanel
 * The "Empty Slot" pattern - quiet structural void
 */

import React from 'react';
import { Button } from '@/components/ui/Button';

interface LayerEmptyStateProps {
  onRefresh?: () => void;
  showRefreshButton?: boolean;
  onOpenSetStudio?: () => void;
}

export const LayerEmptyState: React.FC<LayerEmptyStateProps> = ({
  onRefresh,
  showRefreshButton = false,
  onOpenSetStudio,
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
          className="text-bf-text-faint mb-3"
        >
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>

        {/* Technical status */}
        <span className="text-bf-2xs text-muted-foreground">
          Layer stack empty
        </span>
      </div>

      {/* Subtle footer instruction */}
      <p className="mt-4 text-bf-2xs text-muted-foreground max-w-[160px] leading-relaxed">
        Import volumes via the file browser
      </p>

      {onOpenSetStudio ? (
        <div className="mt-4">
          <Button variant="ghost" size="sm" onClick={onOpenSetStudio}>
            Open Set Studio
          </Button>
          <div className="mt-2 text-bf-2xs text-muted-foreground">
            Shortcut Cmd/Ctrl+5
          </div>
        </div>
      ) : null}

      {showRefreshButton && onRefresh && (
        <button
          onClick={onRefresh}
          className="mt-3 px-3 py-1 text-bf-2xs font-mono border transition-colors pointer-events-auto"
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
