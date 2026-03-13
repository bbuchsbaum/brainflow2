import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DropdownMenu } from '../DropdownMenu';

describe('DropdownMenu', () => {
  const resizeObserverMock = vi.fn(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));

  beforeEach(() => {
    resizeObserverMock.mockClear();
    vi.stubGlobal('ResizeObserver', resizeObserverMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('opens from the trigger and exposes menu semantics', async () => {
    render(
      <DropdownMenu
        trigger={<button type="button">More</button>}
        items={[{ id: 'open', label: 'Open item', onClick: vi.fn() }]}
      />
    );

    const trigger = screen.getByRole('button', { name: 'More' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);

    expect(await screen.findByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Open item' })).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('dispatches enabled items and closes the menu after selection', async () => {
    const itemClick = vi.fn();
    const onItemClick = vi.fn();

    render(
      <DropdownMenu
        trigger={<button type="button">Actions</button>}
        items={[{ id: 'rename', label: 'Rename', onClick: itemClick }]}
        onItemClick={onItemClick}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));

    expect(itemClick).toHaveBeenCalledTimes(1);
    expect(onItemClick).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'rename', label: 'Rename' })
    );

    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  it('keeps disabled items inert', async () => {
    const itemClick = vi.fn();

    render(
      <DropdownMenu
        trigger={<button type="button">Layer menu</button>}
        items={[{ id: 'remove', label: 'Remove layer', disabled: true, onClick: itemClick }]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Layer menu' }));

    const menuItem = await screen.findByRole('menuitem', { name: 'Remove layer' });
    expect(menuItem).toBeDisabled();

    fireEvent.click(menuItem);
    expect(itemClick).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('closes on outside click and Escape', async () => {
    render(
      <div>
        <button type="button">Outside</button>
        <DropdownMenu
          trigger={<button type="button">Presets</button>}
          items={[{ id: 'read', label: 'Read preset', onClick: vi.fn() }]}
        />
      </div>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Presets' }));
    expect(await screen.findByRole('menu')).toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    fireEvent.mouseDown(document.body);
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Presets' }));
    expect(await screen.findByRole('menu')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });
});
