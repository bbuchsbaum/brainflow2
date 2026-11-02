import { act, render } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBidsBrowserDataset } from '@/devHarness/app/bidsBrowserData';
import { getLayoutService } from '@/services/layoutService';
import { useBidsStore } from '@/stores/bidsStore';
import { useBidsFindingsTab } from '../useBidsFindingsTab';

function Host({ type, ready = true }: { type: string | null; ready?: boolean }) {
  useBidsFindingsTab(type, ready);
  return null;
}

const dataset = createBidsBrowserDataset();

describe('useBidsFindingsTab', () => {
  beforeEach(() => {
    const index = dataset.index('s');
    useBidsStore.getState().reset();
    useBidsStore.setState({ index, exclusions: index.exclusions, scanStatus: 'ready' });
    vi.restoreAllMocks();
  });

  it('exists only in the BIDS browser and goes on leaving', () => {
    const service = getLayoutService();
    const scoped = vi.spyOn(service, 'setScopedPanel').mockImplementation(() => undefined);
    const title = vi.spyOn(service, 'setPanelTitle').mockImplementation(() => undefined);
    const { rerender } = render(<Host type="orthogonal" />);
    expect(scoped).not.toHaveBeenCalled();
    rerender(<Host type="bids-explorer" />);
    expect(scoped).toHaveBeenLastCalledWith('BidsFindingsPanel');
    expect(title).toHaveBeenLastCalledWith('BidsFindingsPanel', 'Findings 18');
    rerender(<Host type="orthogonal" />);
    expect(scoped).toHaveBeenLastCalledWith(null);
  });

  it('waits for the layout and follows the count', () => {
    const service = getLayoutService();
    const scoped = vi.spyOn(service, 'setScopedPanel').mockImplementation(() => undefined);
    const title = vi.spyOn(service, 'setPanelTitle').mockImplementation(() => undefined);
    const { rerender } = render(<Host type="bids-explorer" ready={false} />);
    expect(scoped).not.toHaveBeenCalled();
    rerender(<Host type="bids-explorer" />);
    act(() => useBidsStore.getState().setFdThreshold(0.6));
    expect(title.mock.lastCall?.[1]).toMatch(/^Findings \d+$/);
    expect(title.mock.lastCall?.[1]).not.toBe('Findings 18');
    act(() => useBidsStore.setState({ index: dataset.partial('p', 3) }));
    expect(title.mock.lastCall?.[1]).toMatch(/so far$/);
  });
});
