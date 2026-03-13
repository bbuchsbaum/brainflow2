/**
 * ContextMenu
 *
 * Renders a global right-click menu from ContextMenuStore.
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useContextMenuStore } from '@/stores/contextMenuStore';
import { clampContextMenuPosition } from '@/utils/contextMenuPosition';
import { cn } from '@/utils/cn';

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

  useEffect(() => {
    if (!isOpen) return;
    menuRef.current?.focus();
  }, [isOpen, items.length]);

  if (!isOpen) return null;

  const { left, top } =
    typeof window !== 'undefined'
      ? clampContextMenuPosition(
          x,
          y,
          menuSize,
          { width: window.innerWidth, height: window.innerHeight },
          6
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
        ref={menuRef}
        tabIndex={-1}
        role="menu"
        aria-orientation="vertical"
        className="absolute min-w-48 rounded-[1px] border border-border bg-card py-1 shadow-lg outline-none"
        style={{
          left,
          top,
        }}
      >
        {items.map((item) => {
          if (item.separator) {
            return (
              <hr
                key={item.id}
                className="my-1 border-border"
                role="separator"
              />
            );
          }

          const isDisabled = Boolean(item.disabled);

          return (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              aria-disabled={isDisabled}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] font-mono uppercase tracking-wider transition-colors',
                isDisabled
                  ? 'cursor-not-allowed text-muted-foreground/50'
                  : item.danger
                    ? 'text-destructive hover:bg-destructive/10'
                    : 'text-foreground hover:bg-muted/50'
              )}
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
