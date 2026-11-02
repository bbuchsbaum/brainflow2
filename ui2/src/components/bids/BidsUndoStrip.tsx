import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/bf';
import { undoLastExclusion } from '@/services/bids/undoLastExclusion';
import { useBidsStore } from '@/stores/bidsStore';

/** Brief feedback above the dock; the undo history remains after it expires. */
export function BidsUndoStrip() {
  const entry = useBidsStore((state) => state.undoStack.find((item) => item.id === state.undoNoticeId) ?? null);
  const expiresAt = useBidsStore((state) => state.undoNoticeExpiresAt);
  const dismiss = useBidsStore((state) => state.dismissUndoNotice);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!entry || expiresAt === null || hovered || focused) return;
    const timer = setTimeout(() => dismiss(entry.id), Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [entry, expiresAt, dismiss, hovered, focused]);
  if (!entry) return null;
  const rows = entry.added.length;
  const name = rows === 1 ? entry.added[0].entity : `${rows} entities`;
  return (
    <div
      role="status"
      data-testid="bids-undo-strip"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
      className="flex h-8 shrink-0 items-center justify-center gap-3.5 border-t border-bf-border-subtle bg-bf-bg-panel-raised px-3 text-bf-sm"
    >
      <span>
        Excluded {name}. {rows} {rows === 1 ? 'row' : 'rows'} written.
      </span>
      <Button variant="secondary" size="sm" onClick={() => void undoLastExclusion()}>
        Undo ⌘Z
      </Button>
    </div>
  );
}
