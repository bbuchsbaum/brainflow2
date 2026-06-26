import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { BottomWorkbenchDock } from '../BottomWorkbenchDock';
import { DOCK_TABS } from '../bottomWorkbenchDock.constants';

function renderDock(overrides: Partial<React.ComponentProps<typeof BottomWorkbenchDock>> = {}) {
  return render(
    <BottomWorkbenchDock
      plot={<div data-testid="plot-content">plot-content</div>}
      activity={<div data-testid="activity-content">activity-content</div>}
      log={<div data-testid="log-content">log-content</div>}
      {...overrides}
    />,
  );
}

describe('BottomWorkbenchDock', () => {
  it('renders a single tablist with Activity | Plot | Log in spec order', () => {
    renderDock();

    const tablist = screen.getByTestId('bottom-dock-tablist');
    expect(tablist).toHaveAttribute('role', 'tablist');

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Activity', 'Plot', 'Log']);
    // Sanity: matches the shared constant order.
    expect(DOCK_TABS.map((t) => t.label)).toEqual(['Activity', 'Plot', 'Log']);
  });

  it('defaults to the Plot tab and shows only the active panel full-width', () => {
    renderDock();

    expect(screen.getByTestId('bottom-workbench-dock')).toHaveAttribute('data-active-tab', 'plot');
    expect(screen.getByTestId('bottom-dock-tab-plot')).toHaveAttribute('aria-selected', 'true');

    // Only the active tab's content is mounted — the dock is one panel at a time.
    expect(screen.getByTestId('plot-content')).toBeInTheDocument();
    expect(screen.queryByTestId('activity-content')).not.toBeInTheDocument();
    expect(screen.queryByTestId('log-content')).not.toBeInTheDocument();
  });

  it('switches the active panel and notifies on tab click', () => {
    const onActiveTabChange = vi.fn();
    renderDock({ onActiveTabChange });

    fireEvent.click(screen.getByTestId('bottom-dock-tab-log'));

    expect(onActiveTabChange).toHaveBeenCalledTimes(1);
    expect(onActiveTabChange).toHaveBeenCalledWith('log');
    expect(screen.getByTestId('bottom-workbench-dock')).toHaveAttribute('data-active-tab', 'log');
    expect(screen.getByTestId('log-content')).toBeInTheDocument();
    expect(screen.queryByTestId('plot-content')).not.toBeInTheDocument();
    expect(screen.getByTestId('bottom-dock-tab-log')).toHaveAttribute('aria-selected', 'true');
  });

  it('does not re-notify when the already-active tab is clicked', () => {
    const onActiveTabChange = vi.fn();
    renderDock({ onActiveTabChange });

    fireEvent.click(screen.getByTestId('bottom-dock-tab-plot')); // already active
    expect(onActiveTabChange).not.toHaveBeenCalled();
  });

  it('honors a persisted defaultActiveTab', () => {
    renderDock({ defaultActiveTab: 'activity' });

    expect(screen.getByTestId('bottom-workbench-dock')).toHaveAttribute(
      'data-active-tab',
      'activity',
    );
    expect(screen.getByTestId('activity-content')).toBeInTheDocument();
    expect(screen.queryByTestId('plot-content')).not.toBeInTheDocument();
  });

  it('renders a hide button only when onClose is provided, and fires it', () => {
    const { unmount } = renderDock();
    expect(screen.queryByTestId('bottom-dock-close')).toBeNull();
    unmount();

    const onClose = vi.fn();
    renderDock({ onClose });
    fireEvent.click(screen.getByTestId('bottom-dock-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('reflects an externally controlled activeTab (even after mount)', () => {
    // Controlled mode: the visible tab follows the `activeTab` prop, so an
    // external store change (e.g. inspector "Open in dock") switches the tab
    // while the dock is already mounted.
    const onActiveTabChange = vi.fn();
    const { rerender } = render(
      <BottomWorkbenchDock
        plot={<div data-testid="plot-content">plot</div>}
        activity={<div data-testid="activity-content">activity</div>}
        log={<div data-testid="log-content">log</div>}
        activeTab="log"
        onActiveTabChange={onActiveTabChange}
      />,
    );
    expect(screen.getByTestId('log-content')).toBeInTheDocument();

    // External change to the controlled prop switches the visible panel.
    rerender(
      <BottomWorkbenchDock
        plot={<div data-testid="plot-content">plot</div>}
        activity={<div data-testid="activity-content">activity</div>}
        log={<div data-testid="log-content">log</div>}
        activeTab="plot"
        onActiveTabChange={onActiveTabChange}
      />,
    );
    expect(screen.getByTestId('plot-content')).toBeInTheDocument();
    expect(screen.queryByTestId('log-content')).not.toBeInTheDocument();

    // Clicking a tab in controlled mode notifies the parent (which owns state).
    fireEvent.click(screen.getByTestId('bottom-dock-tab-activity'));
    expect(onActiveTabChange).toHaveBeenLastCalledWith('activity');
  });

  it('shows a minimize button (not restore) when expanded and fires onMinimize', () => {
    const onMinimize = vi.fn();
    renderDock({ onMinimize, onRestore: vi.fn() });

    expect(screen.getByTestId('bottom-dock-minimize')).toBeInTheDocument();
    expect(screen.queryByTestId('bottom-dock-restore')).toBeNull();
    // Body is visible while expanded.
    expect(screen.getByTestId('bottom-dock-panel')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('bottom-dock-minimize'));
    expect(onMinimize).toHaveBeenCalledTimes(1);
  });

  it('hides the body and shows a restore button when minimized', () => {
    const onRestore = vi.fn();
    renderDock({ minimized: true, onMinimize: vi.fn(), onRestore });

    // Collapsed to just the tab bar — the body/tabpanel is not rendered.
    expect(screen.queryByTestId('bottom-dock-panel')).toBeNull();
    expect(screen.queryByTestId('plot-content')).not.toBeInTheDocument();

    expect(screen.getByTestId('bottom-dock-restore')).toBeInTheDocument();
    expect(screen.queryByTestId('bottom-dock-minimize')).toBeNull();

    fireEvent.click(screen.getByTestId('bottom-dock-restore'));
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it('restores the dock when a tab is clicked while minimized', () => {
    const onRestore = vi.fn();
    renderDock({ minimized: true, onRestore });

    fireEvent.click(screen.getByTestId('bottom-dock-tab-log'));
    expect(onRestore).toHaveBeenCalledTimes(1);
  });
});
