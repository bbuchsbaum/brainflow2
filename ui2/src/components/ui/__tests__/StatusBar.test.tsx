import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../TimeSlider', () => ({ TimeSlider: () => null }));
vi.mock('../StatusBarProgress', () => ({ StatusBarProgress: () => null }));

import { StatusBar, resolveStatusLayer } from '../StatusBar';
import { useStatusBarStore } from '@/stores/statusBarStore';

describe('resolveStatusLayer', () => {
  const view = [
    { id: 'base', name: 'MNI152 T1', visible: true },
    { id: 'ov', name: 'Motor zstat1', visible: true },
  ];

  it('uses the shared active-layer rule', () => {
    expect(
      resolveStatusLayer(view, { inspectorLayerId: 'base', selectedLayerId: 'ov' }, null)?.id,
    ).toBe('base');
    expect(resolveStatusLayer(view, { inspectorLayerId: null, selectedLayerId: 'base' }, null)?.id).toBe(
      'base',
    );
    // Nothing selected: the topmost visible layer, like the viewport header.
    expect(resolveStatusLayer(view, { inspectorLayerId: null, selectedLayerId: null }, null)?.name).toBe(
      'Motor zstat1',
    );
  });

  it('follows a Compare panel that claimed the readout', () => {
    expect(
      resolveStatusLayer(
        view,
        { inspectorLayerId: null, selectedLayerId: 'base' },
        { layerId: 'ov', name: 'Motor zstat1' },
      ),
    ).toEqual({ id: 'ov', name: 'Motor zstat1' });
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

describe('StatusBar readout text', () => {
  it('shows the shared empty glyph for "--" placeholders', () => {
    const { setValue } = useStatusBarStore.getState();
    setValue('mouse', '--');
    setValue('region', '--');
    const { container } = render(<StatusBar />);
    const mouse = container.querySelector('[data-slot="mouse"] .status-value');
    expect(mouse?.textContent).toBe('—');
    // Region is hidden until an atlas/label layer exists (StatusBar.voxelStat.test).
    expect(container.querySelector('[data-slot="region"]')).toBeNull();
  });

  it('copies coordinates with ASCII minus', () => {
    useStatusBarStore.getState().setValue('crosshair', '(−37.5, −18.5, 17.5)');
    const { container } = render(<StatusBar />);
    const value = container.querySelector('[data-slot="crosshair"] .status-value') as HTMLElement;
    expect(value.textContent).toBe('(−37.5, −18.5, 17.5)');
    const range = document.createRange();
    range.selectNodeContents(value);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const setData = vi.fn();
    const copy = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(copy, 'clipboardData', { value: { setData } });
    value.dispatchEvent(copy);
    expect(setData).toHaveBeenCalledWith('text/plain', '(-37.5, -18.5, 17.5)');
    expect(copy.defaultPrevented).toBe(true);
    selection.removeAllRanges();
  });
});
