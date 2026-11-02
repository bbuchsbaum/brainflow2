import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStatusBarStore } from '@/stores/statusBarStore';
import { StatusBar } from '../StatusBar';

vi.mock('../TimeSlider', () => ({ TimeSlider: () => <div data-testid="time-slider" /> }));
vi.mock('../StatusBarProgress', () => ({ StatusBarProgress: () => null }));

describe('StatusBar workspace status', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
    useStatusBarStore.setState({ values: { crosshair: '(1.0, 2.0, 3.0)' } });
  });

  it('replaces the readouts, so the crosshair Go To cannot fire, and restores them', () => {
    const go = vi.fn();
    render(<StatusBar onCrosshairClick={go} slots={['coordSys', 'crosshair', 'pointer']} />);
    expect(screen.getByText('(1.0, 2.0, 3.0)')).toBeInTheDocument();
    act(() =>
      useStatusBarStore.getState().setBatch([
        ['workspaceStatus', 'BIDS 1.9.0'],
        ['workspaceStatusRight', 'read 1 of 1 files'],
      ]),
    );
    expect(screen.getByTestId('workspace-status').textContent).toBe('BIDS 1.9.0');
    expect(screen.getByTestId('workspace-status-right').textContent).toBe('read 1 of 1 files');
    expect(screen.queryByText('(1.0, 2.0, 3.0)')).toBeNull();
    expect(screen.queryByTestId('time-slider')).toBeNull();
    act(() => {
      useStatusBarStore.getState().removeValue('workspaceStatus');
      useStatusBarStore.getState().removeValue('workspaceStatusRight');
    });
    expect(screen.getByText('(1.0, 2.0, 3.0)')).toBeInTheDocument();
    expect(screen.queryByTestId('workspace-status')).toBeNull();
  });
});
