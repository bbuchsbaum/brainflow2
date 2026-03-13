import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HoverSettingsPopover } from '../HoverSettingsPopover';
import { useHoverSettingsPopoverStore } from '@/stores/hoverSettingsPopoverStore';

vi.mock('../HoverSettingsPanel', () => ({
  HoverSettingsPanel: () => <div>Hover settings content</div>,
}));

describe('HoverSettingsPopover', () => {
  beforeEach(() => {
    useHoverSettingsPopoverStore.setState({
      isOpen: false,
      x: 0,
      y: 0,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clamps the popover position into the viewport', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 160,
      height: 120,
      top: 0,
      right: 160,
      bottom: 120,
      left: 0,
      toJSON: () => ({}),
    });

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 300,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 220,
    });

    act(() => {
      useHoverSettingsPopoverStore.getState().open(260, 180);
    });
    render(<HoverSettingsPopover />);

    const dialog = await screen.findByRole('dialog', { name: 'Hover settings' });
    await waitFor(() => {
      expect(dialog).toHaveStyle({
        left: '132px',
        top: '92px',
      });
    });
  });

  it('closes on Escape, backdrop click, and context menu', async () => {
    act(() => {
      useHoverSettingsPopoverStore.getState().open(40, 50);
    });
    render(<HoverSettingsPopover />);

    expect(await screen.findByRole('dialog', { name: 'Hover settings' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(useHoverSettingsPopoverStore.getState().isOpen).toBe(false);
    });

    act(() => {
      useHoverSettingsPopoverStore.getState().open(40, 50);
    });
    expect(await screen.findByRole('dialog', { name: 'Hover settings' })).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('presentation'));
    await waitFor(() => {
      expect(useHoverSettingsPopoverStore.getState().isOpen).toBe(false);
    });

    act(() => {
      useHoverSettingsPopoverStore.getState().open(40, 50);
    });
    expect(await screen.findByRole('dialog', { name: 'Hover settings' })).toBeInTheDocument();

    fireEvent.contextMenu(screen.getByRole('presentation'));
    await waitFor(() => {
      expect(useHoverSettingsPopoverStore.getState().isOpen).toBe(false);
    });
  });
});
