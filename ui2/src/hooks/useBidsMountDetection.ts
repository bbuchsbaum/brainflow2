import { useEffect } from 'react';
import { getTransport } from '@/services/transport';
import { useBidsStore } from '@/stores/bidsStore';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';

/**
 * The last mount request answered. Outside the hook, so a remounted panel does
 * not take the user back from Tree or scan again. A check that failed or was
 * left behind is not an answer.
 */
let handledRequest = 0;

/** Test seam. */
export function resetBidsMountDetection(): void {
  handledRequest = 0;
}

/**
 * An explicit mount or Recents click of a local dataset: it becomes the one
 * dataset current everywhere, at once. scanDataset owns the switch notice and
 * resets what belonged to the old dataset.
 */
function switchToDataset(path: string): void {
  const bids = useBidsStore.getState();
  if (bids.datasetPath === path && bids.scanStatus !== 'idle') return;
  void bids.scanDataset(path);
}

/**
 * A mounted folder that is a BIDS dataset goes straight to the BIDS view and
 * starts scanning. A remote mount is only offered, since a scan there reaches
 * over the network. The workspace does not change; Files offers the BIDS
 * Explorer as the next step.
 *
 * Only a mount request acts (`lastMount`): selecting a file in another mounted
 * root moves the Files header, not the view or the dataset.
 */
export function useBidsMountDetection(): void {
  const request = useFileBrowserStore((state) => state.lastMount);

  useEffect(() => {
    if (!request || request.nonce <= handledRequest) return;
    let cancelled = false;
    getTransport()
      .invoke<boolean>('check_bids_directory', { path: request.path })
      .then((isBids) => {
        if (cancelled || request.nonce <= handledRequest) return;
        handledRequest = request.nonce;
        if (!isBids) return;
        const files = useFileBrowserStore.getState();
        files.setViewMode('bids');
        if (request.remote) return;
        files.selectFile(request.path);
        switchToDataset(request.path);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [request]);
}
