import { useEffect } from 'react';
import { getEventBus } from '@/events/EventBus';
import { getTransport } from '@/services/transport';
import { DEFAULT_FD_THRESHOLD_MM } from '@/stores/bidsModel';
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
 * dataset current everywhere, at once. scanDataset resets what belonged to the
 * old one; exclusions are on disk already, so only ⌘Z ends, and that is said.
 */
function switchToDataset(path: string): void {
  const bids = useBidsStore.getState();
  if (bids.datasetPath === path && bids.scanStatus !== 'idle') return;
  if (bids.datasetPath && bids.datasetPath !== path) {
    const name = path.split('/').filter(Boolean).pop();
    const undo = bids.undoStack.length > 0;
    const lens = bids.lens !== null;
    const threshold = bids.fdThreshold !== DEFAULT_FD_THRESHOLD_MM || bids.censor !== null;
    const dropped = [lens ? 'the lens' : '', threshold ? 'the motion thresholds' : ''].filter(Boolean).join(' and ');
    if (undo || dropped) {
      getEventBus().emit('ui.notification', {
        type: 'info',
        message: [
          `Switched to ${name}.`,
          undo ? 'Exclusions in the last dataset are saved; undo no longer applies.' : '',
          dropped ? `Cleared ${dropped}.` : '',
        ]
          .filter(Boolean)
          .join(' '),
      });
    }
  }
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
