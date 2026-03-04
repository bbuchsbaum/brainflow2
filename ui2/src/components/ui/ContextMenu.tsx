/**
 * ContextMenu
 *
 * Renders a global right-click menu from ContextMenuStore.
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useContextMenuStore } from '@/stores/contextMenuStore';

export function ContextMenu() {
  const isOpen = useContextMenuStore((s) => s.isOpen);
  const x = useContextMenuStore((s) => s.x);
  const y = useContextMenuStore((s) => s.y);
  const items = useContextMenuStore((s) => s.items);
  const close = useContextMenuStore((s) => s.close);

  const menuRef = useRef<HTMLDivElement>(null);
  const [menuSize, setMenuSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    if (!isOpen || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    setMenuSize({ width: rect.width, height: rect.height });
  }, [isOpen, items.length]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        close();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, close]);

  if (!isOpen) return null;

  const pad = 6;
  const maxX = typeof window !== 'undefined' ? window.innerWidth - menuSize.width - pad : x;
  const maxY = typeof window !== 'undefined' ? window.innerHeight - menuSize.height - pad : y;
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
        ref={menuRef}
        className="absolute min-w-48 shadow-lg py-1"
        style={{
          left,
          top,
          backgroundColor: 'hsl(var(--card))',
          border: '1px solid hsl(var(--border))',
          borderRadius: '1px'
        }}
      >
        {items.map((item) => {
          if (item.separator) {
            return (
              <hr
                key={item.id}
                className="my-1"
                style={{ borderColor: 'hsl(var(--border))' }}
              />
            );
          }

          const isDisabled = Boolean(item.disabled);
          const color = isDisabled
            ? 'hsl(var(--muted-foreground) / 0.5)'
            : item.danger
              ? 'hsl(var(--destructive))'
              : 'hsl(var(--foreground))';

          return (
            <button
              key={item.id}
              type="button"
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] uppercase tracking-wider font-mono transition-colors ${
                isDisabled ? 'cursor-not-allowed' : 'hover:bg-muted/50'
              }`}
              style={{ color }}
              disabled={isDisabled}
              onClick={() => {
                if (isDisabled) return;
                item.onClick?.();
                close();
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

