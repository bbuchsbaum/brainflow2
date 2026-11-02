import React, { useState } from 'react';
import { Button, Notice } from '@/components/ui/bf';
import { getTransport } from '@/services/transport';
import { lastBidsDataset, useBidsStore } from '@/stores/bidsStore';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { safeListen } from '@/utils/eventUtils';

interface BidsDirectoryEvent {
  path: string;
}

export function BidsEmptyState() {
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  // The scan first, so mount detection finds the dataset already current; the
  // mount follows, so Files shows the folder the browser is reading.
  const openDataset = (path: string) => {
    const scanned = useBidsStore.getState().scanDataset(path);
    void useFileBrowserStore
      .getState()
      .mountDirectory(path)
      .catch(() => undefined);
    return scanned;
  };
  // A restored tab asks first: the dataset may be on a drive that is not connected.
  const [last] = useState(lastBidsDataset);

  async function handleOpen() {
    if (opening) return;
    setOpening(true);
    setOpenError(null);

    try {
      const transport = getTransport();

      // Listen for the directory selected event before invoking the dialog
      const unlisten = await safeListen<BidsDirectoryEvent>('bids-directory-event', async (event) => {
        await unlisten();
        setOpening(false);
        if (event.payload?.path) {
          await openDataset(event.payload.path);
        }
      });

      // Fire-and-forget: Rust opens native dialog and emits bids-directory-event on selection
      await transport.invoke<void>('open_bids_dialog');
    } catch (err) {
      setOpening(false);
      setOpenError(
        err instanceof Error ? err.message : 'Could not open a directory picker. Use File > Open BIDS Dataset\u2026'
      );
    }
  }

  return (
    <div
      className="absolute inset-0 flex items-center justify-center bg-background"
      role="region"
      aria-label="BIDS Explorer empty state"
    >
      <div className="w-full px-8" style={{ maxWidth: '720px' }}>
        {/* Section eyebrow */}
        <h2 className="bf-role-title text-foreground">BIDS explorer</h2>

        {/* Body */}
        <p
          className="bf-role-body text-foreground/80 leading-relaxed"
          style={{ marginTop: '32px' }}
        >
          Open a BIDS dataset to see subject coverage, task designs, event timelines, and
          validation results.
        </p>

        {/* Error message */}
        {openError && (
          <Notice severity="danger" role="alert" className="mt-3">
            {openError}
          </Notice>
        )}

        {/* Primary CTA */}
        <div className="flex gap-2" style={{ marginTop: '24px' }}>
          {last && (
            <Button variant="primary" size="sm" onClick={() => void openDataset(last)}>
              Reopen {last.split('/').filter(Boolean).pop()}
            </Button>
          )}
          <Button
            variant={last ? 'secondary' : 'primary'}
            size="sm"
            onClick={() => void handleOpen()}
            loading={opening}
            disabled={opening}
          >
            {opening ? 'Opening\u2026' : 'Open dataset'}
          </Button>
        </div>

        {/* Drag-drop hint */}
        <p
          className="bf-role-label text-muted-foreground"
          style={{ marginTop: '16px' }}
        >
          You can also drag a BIDS dataset folder onto this panel.
        </p>
      </div>
    </div>
  );
}
