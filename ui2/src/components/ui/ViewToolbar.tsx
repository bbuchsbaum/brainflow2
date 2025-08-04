/**
 * ViewToolbar Component
 * 
 * Toolbar for view-related controls including crosshair settings.
 * Can be added to various view containers.
 */

import React from 'react';
import { CrosshairToggle } from './CrosshairToggle';
import { CrosshairSettingsPopover } from './CrosshairSettingsPopover';
import { cn } from '@/utils/cn';

interface ViewToolbarProps {
  className?: string;
  showCrosshairControls?: boolean;
}

export function ViewToolbar({ 
  className,
  showCrosshairControls = true 
}: ViewToolbarProps) {
  return (
    <div className={cn(
      "flex items-center gap-2 px-3 py-2",
      "bg-[var(--app-bg-secondary)] border-b border-[var(--app-border)]",
      className
    )}>
      {showCrosshairControls && (
        <>
          <CrosshairToggle />
          <CrosshairSettingsPopover />
          <div className="w-px h-6 bg-[var(--app-border)]" />
        </>
      )}
      
      {/* Space for additional tools */}
      <div className="flex-1" />
      
      {/* Future tools can be added here */}
    </div>
  );
}