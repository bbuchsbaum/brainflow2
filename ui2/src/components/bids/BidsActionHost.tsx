/**
 * Carries out what the keyboard and the Inspector ask for through
 * `requestAction`: the quick look, the exclude dialog and the comparison.
 */
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getLayoutService } from '@/services/layoutService';
import { useBidsStore } from '@/stores/bidsStore';
import { BidsExcludeDialog } from './BidsExcludeDialog';
import { BidsQuickLook } from './BidsQuickLook';

export function BidsActionHost() {
  const request = useBidsStore((state) => state.actionRequest);
  const clearActionRequest = useBidsStore((state) => state.clearActionRequest);
  const toggleCompare = useBidsStore((state) => state.toggleCompare);
  const [open, setOpen] = useState<{ kind: 'quick-look' | 'exclude'; runId: string } | null>(null);

  useEffect(() => {
    if (!request) return;
    clearActionRequest();
    if (!request.runId) return;
    const { kind, runId } = request;
    if (kind === 'quick-look' || kind === 'exclude') {
      setOpen({ kind, runId });
    } else if (kind === 'compare') {
      toggleCompare();
      getLayoutService().showPanel('Inspector');
    }
  }, [request, clearActionRequest, toggleCompare]);

  if (!open) return null;
  // To the body: the view pane is its own stacking context, below the dock.
  return createPortal(
    open.kind === 'quick-look' ? (
      <BidsQuickLook runId={open.runId} onClose={() => setOpen(null)} />
    ) : (
      <BidsExcludeDialog runId={open.runId} onClose={() => setOpen(null)} />
    ),
    document.body,
  );
}
