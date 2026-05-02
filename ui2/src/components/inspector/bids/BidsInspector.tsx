import React from 'react';

/**
 * Placeholder BIDS Inspector body. Replaced once BIDS subject metadata,
 * coverage matrix, and scan-level facts are wired into the right rail.
 */
export function BidsInspector() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-3 py-8 text-center text-[12px] text-muted-foreground">
      <div className="text-foreground">No BIDS subject selected</div>
      <div className="text-[11px] text-muted-foreground/80">
        Pick a subject in the BIDS Explorer to see scan-level details here.
      </div>
    </div>
  );
}
