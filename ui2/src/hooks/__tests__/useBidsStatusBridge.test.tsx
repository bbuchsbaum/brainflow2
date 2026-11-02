import { useWorkspaceStore } from '@/stores/workspaceStore';
import { act, render, renderHook } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBidsBrowserDataset } from '@/devHarness/app/bidsBrowserData';
import { selectBidsModel, useBidsStore } from '@/stores/bidsStore';
import { useStatusBarStore } from '@/stores/statusBarStore';
import { bidsStatusParts, formatBytes, useBidsScanOwnership, useBidsStatusBridge } from '../useBidsStatusBridge';

const text = (node: unknown) => {
  const { container, unmount } = render(<>{node}</>);
  const value = container.textContent;
  unmount();
  return value;
};

function Host({ type }: { type: string | null }) {
  useBidsStatusBridge(type);
  return null;
}

const dataset = createBidsBrowserDataset();

beforeEach(() => {
  const index = dataset.index('s');
  useBidsStore.getState().reset();
  useBidsStore.setState({ index, exclusions: index.exclusions, scanStatus: 'ready' });
  useStatusBarStore.setState({ values: { crosshair: '(1.0, 2.0, 3.0)', coordSys: 'RAS' } });
});

describe('useBidsStatusBridge', () => {
  it('writes its own slots and leaves the crosshair slot alone', () => {
    const { rerender, unmount } = render(<Host type="bids-explorer" />);
    const values = useStatusBarStore.getState().values;
    expect(values.crosshair).toBe('(1.0, 2.0, 3.0)');
    expect(text(values.workspaceStatus)).toContain('BIDS 1.9.0 · dataset v1.2.0');
    expect(text(values.workspaceStatus)).toContain('40 participants · 1,071 files · 182.4 GB');
    expect(text(values.workspaceStatusRight)).toContain('read 1,071 of 1,071 files');

    // Other writers keep going underneath and survive the visit.
    act(() => useStatusBarStore.getState().setValue('crosshair', '(4.0, 5.0, 6.0)'));
    rerender(<Host type="orthogonal" />);
    const after = useStatusBarStore.getState().values;
    expect(after.workspaceStatus).toBeUndefined();
    expect(after.workspaceStatusRight).toBeUndefined();
    expect(after.crosshair).toBe('(4.0, 5.0, 6.0)');
    expect(after.coordSys).toBe('RAS');
    unmount();
  });

  it('restores on unmount and follows the model', () => {
    const { unmount } = render(<Host type="bids-explorer" />);
    const entity = 'sub-33_ses-02_task-nback_run-1_bold';
    const row = { entity, scope: 'run', reason: 'r', criterion: 'c', value: '', author: 'a', date: 'd', source: '' };
    act(() => useBidsStore.setState({ exclusions: [...useBidsStore.getState().exclusions, row] }));
    expect(text(useStatusBarStore.getState().values.workspaceStatus)).toContain('Excluded 2 runs');
    unmount();
    expect(useStatusBarStore.getState().values.workspaceStatus).toBeUndefined();
  });

  it('never writes outside the BIDS browser', () => {
    render(<Host type="orthogonal" />);
    expect(useStatusBarStore.getState().values.workspaceStatus).toBeUndefined();
  });

  it('says so far while the scan is partial', () => {
    act(() => useBidsStore.setState({ index: dataset.partial('p', 3) }));
    const { left } = bidsStatusParts(selectBidsModel(useBidsStore.getState()));
    expect(left[1]).toMatch(/so far$/);
    expect(left[2]).toMatch(/so far$/);
  });

  it('keeps validator and check counts apart', () => {
    const { validator } = bidsStatusParts(selectBidsModel(useBidsStore.getState()));
    expect(validator.map((part) => part.text).join(' ')).toBe(
      'validator 1 error 0 warnings checks 1 error 2 warnings',
    );
  });

  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });
});

describe('useBidsScanOwnership', () => {
  it('stops the scan when the last BIDS tab closes', () => {
    const cancelScan = vi.fn(async () => undefined);
    useBidsStore.setState({ cancelScan });
    const tab = new Map([['b', { type: 'bids-explorer' }]]);
    useWorkspaceStore.setState({ workspaces: tab as never });
    const { unmount } = renderHook(() => useBidsScanOwnership());
    useWorkspaceStore.setState({ workspaces: new Map([['b', { type: 'bids-explorer' }]]) as never });
    expect(cancelScan).not.toHaveBeenCalled();
    useWorkspaceStore.setState({ workspaces: new Map() as never });
    expect(cancelScan).toHaveBeenCalledTimes(1);
    unmount();
  });
});
