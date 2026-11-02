import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CenterWithBottomDock } from '../CenterWithBottomDock';
import { useLayoutSettingsStore } from '@/stores/layoutSettingsStore';

vi.mock('@/components/panels/PlotPanel', () => ({ PlotPanel: () => null }));
vi.mock('@/components/panels/ClusterPanel', () => ({ ClusterPanel: () => null }));
vi.mock('@/components/panels/ActivityPanel', () => ({ ActivityPanel: () => null }));
vi.mock('@/components/panels/LogPanel', () => ({ LogPanel: () => null }));

beforeEach(() => {
  useLayoutSettingsStore.setState({ bottomDockOpenByKey: {}, bottomDockMinimized: false });
});

describe('CenterWithBottomDock footer', () => {
  it('sits below the dock and reserves its height', () => {
    render(
      <CenterWithBottomDock footer={<span>hints</span>} footerHeight={26}>
        <div />
      </CenterWithBottomDock>,
    );
    expect(screen.getByTestId('center-dock-footer').style.bottom).toBe('0px');
    expect(screen.getByTestId('center-dock-pane').style.bottom).toBe('26px');
    const dock = Number.parseInt(screen.getByTestId('center-dock-pane').style.height, 10);
    expect(screen.getByTestId('center-view-pane').style.bottom).toBe(`${dock + 6 + 26}px`);
  });

  it('stays when the dock is closed', () => {
    useLayoutSettingsStore.getState().setBottomDockOpen(false, 'imaging');
    render(
      <CenterWithBottomDock footer={<span>hints</span>} footerHeight={26}>
        <div />
      </CenterWithBottomDock>,
    );
    expect(screen.getByTestId('center-view-pane').style.bottom).toBe('26px');
    expect(screen.getByText('hints')).toBeInTheDocument();
  });

  it('reserves nothing without a footer', () => {
    render(
      <CenterWithBottomDock footerHeight={26}>
        <div />
      </CenterWithBottomDock>,
    );
    expect(screen.queryByTestId('center-dock-footer')).toBeNull();
    expect(screen.getByTestId('center-dock-pane').style.bottom).toBe('0px');
  });
});
