import React from 'react';
import { Button } from '@/components/ui/bf';
import { undoLastExclusion } from '@/services/bids/undoLastExclusion';
import { useBidsStore } from '@/stores/bidsStore';

/** The last exclusion, above the dock. It belongs to this workspace and leaves with it. */
export function BidsUndoStrip() {
  const entry = useBidsStore((state) => state.undoStack[state.undoStack.length - 1] ?? null);
  if (!entry) return null;
  const rows = entry.added.length;
  const name = rows === 1 ? entry.added[0].entity : `${rows} entities`;
  return (
    <div
      role="status"
      data-testid="bids-undo-strip"
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
