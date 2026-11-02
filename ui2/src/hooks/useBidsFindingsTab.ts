import { useEffect } from 'react';
import { BIDS_FINDINGS_PANEL, getLayoutService } from '@/services/layoutService';
import { selectBidsModel, useBidsStore } from '@/stores/bidsStore';

/**
 * Findings is a tab of the left stack only while the BIDS browser is in front.
 * Its title carries the one count the summary and status bar show.
 */
export function useBidsFindingsTab(workspaceType: string | null, layoutReady: boolean): void {
  const active = workspaceType === 'bids-explorer';
  useEffect(() => {
    if (!layoutReady || !active) return;
    const service = getLayoutService();
    service.setScopedPanel(BIDS_FINDINGS_PANEL);
    const writeTitle = () => {
      const { findings, status } = selectBidsModel(useBidsStore.getState());
      service.setPanelTitle(
        BIDS_FINDINGS_PANEL,
        `Findings ${findings.total}${status.soFar ? ' so far' : ''}`,
      );
    };
    writeTitle();
    const stop = useBidsStore.subscribe(writeTitle);
    return () => {
      stop();
      service.setScopedPanel(null);
    };
  }, [active, layoutReady]);
}
