import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BottomWorkbenchDock } from '../BottomWorkbenchDock';
import { DEFAULT_DOCK_TAB } from '../bottomWorkbenchDock.constants';

const EXTRA = [{ id: 'bids.runs', title: 'Runs', content: <div>runs body</div> }];
const slots = { plot: <div>plot body</div>, activity: <div />, log: <div /> };

describe('BottomWorkbenchDock extraTabs', () => {
  it('adds the tab and renders its body', () => {
    render(<BottomWorkbenchDock {...slots} extraTabs={EXTRA} activeTab="bids.runs" onActiveTabChange={vi.fn()} />);
    expect(screen.getByTestId('bottom-dock-tab-bids.runs')).toBeInTheDocument();
    expect(screen.getByText('runs body')).toBeInTheDocument();
  });

  it('falls back to the default tab when a dock without it is asked for it', () => {
    render(<BottomWorkbenchDock {...slots} activeTab="bids.runs" onActiveTabChange={vi.fn()} />);
    expect(screen.queryByTestId('bottom-dock-tab-bids.runs')).toBeNull();
    expect(screen.getByTestId('bottom-workbench-dock').dataset.activeTab).toBe(DEFAULT_DOCK_TAB);
    expect(screen.getByText('plot body')).toBeInTheDocument();
  });
});
