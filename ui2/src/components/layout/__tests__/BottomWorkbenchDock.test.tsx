import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const { onChangeRef, defaultSizesRef, paneCallsRef } = vi.hoisted(() => ({
  onChangeRef: { current: null as null | ((sizes: number[]) => void) },
  defaultSizesRef: { current: null as null | number[] },
  paneCallsRef: { current: [] as Array<{ minSize?: number; snap?: boolean }> },
}));

vi.mock('allotment', () => {
  type AllotmentMockProps = {
    children: React.ReactNode;
    defaultSizes?: number[];
    onChange?: (sizes: number[]) => void;
  };
  const Allotment = React.forwardRef<unknown, AllotmentMockProps>(
    ({ children, defaultSizes, onChange }, ref) => {
      defaultSizesRef.current = defaultSizes ?? null;
      onChangeRef.current = onChange ?? null;
      React.useImperativeHandle(ref, () => ({ resize: vi.fn(), reset: vi.fn() }));
      return (
        <div
          data-testid="allotment-mock"
          data-default-sizes={JSON.stringify(defaultSizes ?? [])}
        >
          {children}
        </div>
      );
    },
  );
  Allotment.displayName = 'AllotmentMock';

  type PaneMockProps = {
    children: React.ReactNode;
    minSize?: number;
    snap?: boolean;
  };
  const Pane = ({ children, minSize, snap }: PaneMockProps) => {
    paneCallsRef.current.push({ minSize, snap });
    return (
      <div
        data-testid="allotment-pane"
        data-minsize={minSize}
        data-snap={snap ? 'true' : 'false'}
      >
        {children}
      </div>
    );
  };

  const AllotmentWithPane = Allotment as typeof Allotment & { Pane: typeof Pane };
  AllotmentWithPane.Pane = Pane;
  return { Allotment: AllotmentWithPane, default: AllotmentWithPane };
});

import { BottomWorkbenchDock } from '../BottomWorkbenchDock';
import {
  DEFAULT_DOCK_SIZES,
  DOCK_COLLAPSED_LOG_WIDTH,
} from '../bottomWorkbenchDock.constants';

function renderDock(overrides: Partial<React.ComponentProps<typeof BottomWorkbenchDock>> = {}) {
  paneCallsRef.current = [];
  defaultSizesRef.current = null;
  onChangeRef.current = null;
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
  it('renders three panes with the default 50/30/20 allocation', () => {
    renderDock();

    const panes = screen.getAllByTestId('allotment-pane');
    expect(panes).toHaveLength(3);

    expect(defaultSizesRef.current).toEqual([...DEFAULT_DOCK_SIZES]);
    expect(DEFAULT_DOCK_SIZES).toEqual([50, 30, 20]);

    expect(screen.getByTestId('plot-content')).toBeInTheDocument();
    expect(screen.getByTestId('activity-content')).toBeInTheDocument();
    expect(screen.getByTestId('log-content')).toBeInTheDocument();
  });

  it('forwards a custom defaultSizes tuple to Allotment', () => {
    renderDock({ defaultSizes: [60, 25, 15] });
    expect(defaultSizesRef.current).toEqual([60, 25, 15]);
  });

  it('configures Plot/Activity panes for full-range resize (minSize 0 + snap)', () => {
    renderDock();
    const [plotPaneCfg, activityPaneCfg, logPaneCfg] = paneCallsRef.current;

    // Plot pane must be drag-resizable from 0% to 100%.
    expect(plotPaneCfg.minSize).toBe(0);
    expect(plotPaneCfg.snap).toBe(true);

    // Activity pane mirrors Plot's freedom.
    expect(activityPaneCfg.minSize).toBe(0);
    expect(activityPaneCfg.snap).toBe(true);

    // Log pane retains a thin affordance — never drag-disappears entirely.
    expect(logPaneCfg.minSize).toBe(DOCK_COLLAPSED_LOG_WIDTH);
  });

  it('exposes splitter sizes to a persistence callback when the user drags', () => {
    const onSizesChange = vi.fn();
    renderDock({ onSizesChange });

    expect(onChangeRef.current).toBeTypeOf('function');
    act(() => {
      onChangeRef.current?.([400, 300, 100]);
    });

    expect(onSizesChange).toHaveBeenCalledTimes(1);
    expect(onSizesChange).toHaveBeenCalledWith([400, 300, 100]);
  });

  it('toggles plot maximization on click and notifies', () => {
    const onPlotMaximizedChange = vi.fn();
    renderDock({ onPlotMaximizedChange });

    const btn = screen.getByTestId('dock-plot-maximize');
    fireEvent.click(btn);
    expect(onPlotMaximizedChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByTestId('bottom-workbench-dock').getAttribute('data-plot-maximized')).toBe(
      'true',
    );

    fireEvent.click(btn);
    expect(onPlotMaximizedChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByTestId('bottom-workbench-dock').getAttribute('data-plot-maximized')).toBe(
      'false',
    );
  });

  it('collapses the Log pane to the 24px header-only affordance and restores it', () => {
    const onLogCollapsedChange = vi.fn();
    renderDock({ onLogCollapsedChange });

    const logPane = screen.getByTestId('dock-log-pane');
    expect(logPane.getAttribute('data-collapsed')).toBe('false');
    expect(screen.getByTestId('log-content')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('dock-log-collapse'));
    expect(onLogCollapsedChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByTestId('dock-log-pane').getAttribute('data-collapsed')).toBe('true');
    // Body content must be hidden so total pane size can shrink to ≤24px.
    expect(screen.queryByTestId('log-content')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('dock-log-collapse'));
    expect(onLogCollapsedChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByTestId('dock-log-pane').getAttribute('data-collapsed')).toBe('false');
    expect(screen.getByTestId('log-content')).toBeInTheDocument();
  });

  it('does not render an Activity|Plot|Log tab strip', () => {
    const { container } = renderDock();
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.querySelectorAll('[role="tab"]').length).toBe(0);
    // GoldenLayout would create .lm_tabs / .lm_tab — this dock must not.
    expect(container.querySelector('.lm_tabs')).toBeNull();
    expect(container.querySelectorAll('.lm_tab').length).toBe(0);
  });

  it('plot maximize and log collapse are mutually exclusive states', () => {
    const onPlot = vi.fn();
    const onLog = vi.fn();
    renderDock({ onPlotMaximizedChange: onPlot, onLogCollapsedChange: onLog });

    fireEvent.click(screen.getByTestId('dock-log-collapse'));
    expect(screen.getByTestId('bottom-workbench-dock').getAttribute('data-log-collapsed')).toBe(
      'true',
    );

    fireEvent.click(screen.getByTestId('dock-plot-maximize'));
    expect(screen.getByTestId('bottom-workbench-dock').getAttribute('data-plot-maximized')).toBe(
      'true',
    );
    // Maximizing plot should release the log collapse.
    expect(screen.getByTestId('bottom-workbench-dock').getAttribute('data-log-collapsed')).toBe(
      'false',
    );
    expect(onLog).toHaveBeenLastCalledWith(false);
  });

  it('honors defaultPlotMaximized and defaultLogCollapsed initial state', () => {
    renderDock({ defaultPlotMaximized: true, defaultLogCollapsed: false });
    expect(screen.getByTestId('bottom-workbench-dock').getAttribute('data-plot-maximized')).toBe(
      'true',
    );
  });
});
