import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ColormapSelector } from '../ColormapSelector';

describe('ColormapSelector', () => {
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

  it('renders the current selection and opens the colormap listbox', async () => {
    render(<ColormapSelector value="viridis" onChange={vi.fn()} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Select colormap. Current colormap is Viridis' })
    );

    expect(await screen.findByRole('listbox', { name: 'Colormap options' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Viridis' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: 'Turbo' })).toHaveAttribute('aria-selected', 'false');
  });

  it('dispatches selection changes and closes the options list after selection', async () => {
    const onChange = vi.fn();

    render(<ColormapSelector value="gray" onChange={onChange} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Select colormap. Current colormap is Grayscale' })
    );
    fireEvent.click(await screen.findByRole('option', { name: 'Turbo' }));

    expect(onChange).toHaveBeenCalledWith('turbo');
    await waitFor(() => {
      expect(screen.queryByRole('listbox', { name: 'Colormap options' })).not.toBeInTheDocument();
    });
  });

  it('respects the disabled state', () => {
    render(<ColormapSelector value="gray" onChange={vi.fn()} disabled />);

    const trigger = screen.getByRole('button', {
      name: 'Select colormap. Current colormap is Grayscale',
    });
    expect(trigger).toBeDisabled();
  });
});
