/**
 * CrosshairToggle Component
 * 
 * Toolbar button for quickly toggling crosshair visibility.
 * Part of the three-tier crosshair settings approach.
 */

import React, { useEffect } from 'react';
import { Crosshair } from 'lucide-react';
import { useCrosshairSettings } from '@/contexts/CrosshairContext';
import { cn } from '@/utils/cn';

interface CrosshairToggleProps {
  className?: string;
  showLabel?: boolean;
}

export function CrosshairToggle({ className, showLabel = false }: CrosshairToggleProps) {
  const { settings, toggleVisibility } = useCrosshairSettings();
  
  // Register keyboard shortcut
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // 'C' key toggles crosshair
      if (e.key === 'c' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Check if we're not in an input field
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          e.preventDefault();
          toggleVisibility();
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [toggleVisibility]);
  
  return (
    <button
      type="button"
      onClick={toggleVisibility}
      className={cn(
        "inline-flex items-center justify-center",
        "h-8 px-3 rounded-md",
        "text-sm font-medium",
        "transition-all duration-200",
        "focus:outline-none focus:ring-2 focus:ring-offset-2",
        settings.visible ? [
          "bg-[var(--app-accent)] text-white",
          "hover:bg-[var(--app-accent-hover)]",
          "focus:ring-[var(--app-accent)]"
        ] : [
          "bg-[var(--app-bg-secondary)] text-[var(--app-text-secondary)]",
          "hover:bg-[var(--app-bg-hover)] hover:text-[var(--app-text-primary)]",
          "focus:ring-[var(--app-border-focus)]"
        ],
        className
      )}
      aria-label={settings.visible ? "Hide crosshair" : "Show crosshair"}
      aria-pressed={settings.visible}
      title={`${settings.visible ? 'Hide' : 'Show'} crosshair (C)`}
    >
      <Crosshair className={cn("h-4 w-4", showLabel && "mr-2")} />
      {showLabel && (
        <span>{settings.visible ? 'Hide' : 'Show'} Crosshair</span>
      )}
    </button>
  );
}