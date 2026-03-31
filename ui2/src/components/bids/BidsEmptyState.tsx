import React, { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { getTransport } from '@/services/transport';
import { useBidsStore } from '@/stores/bidsStore';
import { safeListen } from '@/utils/eventUtils';

interface BidsDirectoryEvent {
  path: string;
}

export function BidsEmptyState() {
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const scanDataset = useBidsStore((state) => state.scanDataset);

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
          await scanDataset(event.payload.path);
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
        <p className="bf-role-section text-muted-foreground">BIDS EXPLORER</p>

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
          <p
            className="bf-role-body mt-3"
            style={{ color: 'var(--app-error)' }}
            role="alert"
          >
            {openError}
          </p>
        )}

        {/* Primary CTA */}
        <div style={{ marginTop: '24px' }}>
          <Button
            variant="primary"
            onClick={() => void handleOpen()}
            loading={opening}
            disabled={opening}
            className="
              !bg-primary !text-primary-foreground
              hover:!bg-[hsl(var(--primary)/0.88)]
              !rounded-appsm
              !text-[11px] !font-semibold !tracking-[0.08em] uppercase
              !px-4 !py-2
              focus:!ring-primary
            "
          >
            {opening ? 'Opening\u2026' : 'Open Dataset'}
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
