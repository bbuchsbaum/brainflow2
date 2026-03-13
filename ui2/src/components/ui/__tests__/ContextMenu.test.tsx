import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextMenu } from '../ContextMenu';
import { useContextMenuStore } from '@/stores/contextMenuStore';

describe('ContextMenu', () => {
  beforeEach(() => {
    act(() => {
      useContextMenuStore.setState({
        isOpen: false,
        x: 0,
        y: 0,
        items: [],
      });
    });
  });

  afterEach(() => {
    act(() => {
      useContextMenuStore.setState({
        isOpen: false,
        x: 0,
        y: 0,
        items: [],
      });
    });
    vi.restoreAllMocks();
  });

  it('clamps the menu position into the viewport and exposes menu semantics', async () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 320,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 240,
    });

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 120,
      height: 80,
      top: 0,
      right: 120,
      bottom: 80,
      left: 0,
      toJSON: () => ({}),
    });

    act(() => {
      useContextMenuStore.getState().open(310, 210, [
        { id: 'hover-info', label: 'Hover Info…', onClick: vi.fn() },
      ]);
    });

    render(<ContextMenu />);

    const menu = await screen.findByRole('menu');
    expect(screen.getByRole('menuitem', { name: 'Hover Info…' })).toBeInTheDocument();

    await waitFor(() => {
      expect(menu).toHaveStyle({
        left: '194px',
        top: '154px',
      });
    });
  });

  it('dispatches item actions and closes after selection', async () => {
    const onClick = vi.fn();

    act(() => {
      useContextMenuStore.getState().open(40, 50, [
        { id: 'export', label: 'Export', onClick },
      ]);
    });

    render(<ContextMenu />);

    fireEvent.click(await screen.findByRole('menuitem', { name: 'Export' }));

    expect(onClick).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(useContextMenuStore.getState().isOpen).toBe(false);
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  it('closes on Escape, backdrop click, and right-click dismissal', async () => {
    render(<ContextMenu />);

    act(() => {
      useContextMenuStore.getState().open(40, 50, [
        { id: 'hover-info', label: 'Hover Info…', onClick: vi.fn() },
      ]);
    });
    expect(await screen.findByRole('menu')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(useContextMenuStore.getState().isOpen).toBe(false);
    });

    act(() => {
      useContextMenuStore.getState().open(40, 50, [
        { id: 'hover-info', label: 'Hover Info…', onClick: vi.fn() },
      ]);
    });
    expect(await screen.findByRole('menu')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('presentation'));
    await waitFor(() => {
      expect(useContextMenuStore.getState().isOpen).toBe(false);
    });

    act(() => {
      useContextMenuStore.getState().open(40, 50, [
        { id: 'hover-info', label: 'Hover Info…', onClick: vi.fn() },
      ]);
    });
    expect(await screen.findByRole('menu')).toBeInTheDocument();

    fireEvent.contextMenu(screen.getByRole('presentation'));
    await waitFor(() => {
      expect(useContextMenuStore.getState().isOpen).toBe(false);
    });
  });
});
