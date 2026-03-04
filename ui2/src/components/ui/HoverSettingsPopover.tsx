/**
 * HoverSettingsPopover
 *
 * A positioned popover containing the HoverSettingsPanel.
 * Can be opened from context menu or status bar gear icon.
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useHoverSettingsPopoverStore } from '@/stores/hoverSettingsPopoverStore';
import { HoverSettingsPanel } from './HoverSettingsPanel';

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

  // Handle click outside and escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        close();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
      }
    };

    // Delay adding listener to avoid immediate close from opening click
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    document.addEventListener('keydown', handleEscape);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, close]);

  if (!isOpen) return null;

  // Calculate position to keep popover on screen
  const pad = 8;
  const maxX =
    typeof window !== 'undefined' ? window.innerWidth - popoverSize.width - pad : x;
  const maxY =
    typeof window !== 'undefined' ? window.innerHeight - popoverSize.height - pad : y;
  const left = Math.max(pad, Math.min(x, maxX));
  const top = Math.max(pad, Math.min(y, maxY));

  return (
    <div
      className="fixed inset-0 z-50"
      onContextMenu={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div
        ref={popoverRef}
        className="absolute shadow-lg"
        style={{
          left,
          top,
          backgroundColor: 'hsl(var(--card))',
          border: '1px solid hsl(var(--border))',
          borderRadius: '4px',
          minWidth: '220px',
        }}
      >
        <HoverSettingsPanel />
      </div>
    </div>
  );
}
