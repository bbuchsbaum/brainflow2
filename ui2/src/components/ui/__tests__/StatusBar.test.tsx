import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../TimeSlider', () => ({ TimeSlider: () => null }));
vi.mock('../StatusBarProgress', () => ({ StatusBarProgress: () => null }));

import { StatusBar, resolveStatusLayerName } from '../StatusBar';
import { useStatusBarStore } from '@/stores/statusBarStore';

describe('resolveStatusLayerName', () => {
  const items = [
    { id: 'base', name: 'MNI152 T1' },
    { id: 'ov', name: 'Motor zstat1' },
  ];
  const layers = [
    { id: 'base', name: 'MNI152 T1' },
    { id: 'ov', name: 'Motor zstat1' },
  ];

  it('prefers the Inspector selection', () => {
    expect(resolveStatusLayerName('ov', items, 'base', layers, 'MNI152 T1')).toBe('Motor zstat1');
  });

  it('falls back to the selected layer, then to the service value', () => {
    expect(resolveStatusLayerName(null, items, 'ov', layers, 'MNI152 T1')).toBe('Motor zstat1');
    expect(resolveStatusLayerName(null, items, null, layers, 'MNI152 T1')).toBe('MNI152 T1');
    expect(resolveStatusLayerName('gone', items, null, layers, null)).toBeNull();
  });
});

describe('StatusBar diagnostics', () => {
  beforeEach(() => {
    const { setValue } = useStatusBarStore.getState();
    setValue('coordSys', 'RAS');
    setValue('crosshair', '(0.0, 0.0, 0.0)');
    setValue('atlas', '3D atlas occupied');
    setValue('fps', '60.0 fps');
    setValue('gpu', 'Ready');
  });

  it('keeps telemetry out of the bar and lists it in an Escape-closable popover', async () => {
    render(<StatusBar />);
    expect(screen.getByText('Coordinate system')).toBeInTheDocument();
    expect(screen.getByText('Crosshair')).toBeInTheDocument();
    expect(screen.queryByText('60.0 fps')).not.toBeInTheDocument();
    expect(screen.queryByText('3D atlas occupied')).not.toBeInTheDocument();

    const trigger = screen.getByTestId('status-diagnostics-trigger');
    expect(trigger).toHaveAccessibleName('Diagnostics');
    trigger.focus();
    fireEvent.click(trigger);
    const popover = await screen.findByTestId('status-diagnostics-popover');
    expect(popover).toHaveTextContent('3D atlas occupied');
    expect(popover).toHaveTextContent('60.0 fps');
    expect(popover).toHaveTextContent('Ready');

    fireEvent.keyDown(popover, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByTestId('status-diagnostics-popover')).not.toBeInTheDocument(),
    );
  });

  it('flags atlas pressure on the closed button', () => {
    useStatusBarStore.getState().setValue('atlas', 'Atlas 7/8 · 1 free · Warning');
    render(<StatusBar />);
    const trigger = screen.getByTestId('status-diagnostics-trigger');
    expect(trigger).toHaveAttribute('data-severity', 'warning');
    expect(trigger).toHaveAccessibleName('Diagnostics (atlas warning)');
  });
});
