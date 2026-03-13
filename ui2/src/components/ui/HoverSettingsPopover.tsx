/**
 * HoverSettingsPopover
 *
 * A positioned popover containing the HoverSettingsPanel.
 * Can be opened from context menu or status bar gear icon.
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useHoverSettingsPopoverStore } from '@/stores/hoverSettingsPopoverStore';
import { HoverSettingsPanel } from './HoverSettingsPanel';
import { clampPopoverPosition } from '@/utils/popoverPosition';

export function HoverSettingsPopover() {
  const isOpen = useHoverSettingsPopoverStore((s) => s.isOpen);
  const x = useHoverSettingsPopoverStore((s) => s.x);
  const y = useHoverSettingsPopoverStore((s) => s.y);
  const close = useHoverSettingsPopoverStore((s) => s.close);

  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverSize, setPopoverSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  // Measure popover size after opening
  useLayoutEffect(() => {
    if (!isOpen || !popoverRef.current) return;
    const rect = popoverRef.current.getBoundingClientRect();
    setPopoverSize({ width: rect.width, height: rect.height });
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
      }
    };

    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, close]);

  if (!isOpen) return null;

  // Calculate position to keep popover on screen
  const { left, top } =
    typeof window !== 'undefined'
      ? clampPopoverPosition(
          x,
          y,
          popoverSize,
          { width: window.innerWidth, height: window.innerHeight },
          8
        )
      : { left: x, top: y };

  return (
    <div
      className="fixed inset-0 z-50"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          close();
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div
        ref={popoverRef}
        className="absolute shadow-lg"
        role="dialog"
        aria-label="Hover settings"
        aria-modal="false"
        style={{
          left,
          top,
          backgroundColor: 'hsl(var(--card))',
          border: '1px solid hsl(var(--border))',
          borderRadius: '4px',
          minWidth: '220px',
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <HoverSettingsPanel />
      </div>
    </div>
  );
}
