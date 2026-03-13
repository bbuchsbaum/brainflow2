import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnhancedColormapSelector } from '../EnhancedColormapSelector';

describe('EnhancedColormapSelector', () => {
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

  it('renders the current colormap label and opens the palette picker', async () => {
    render(<EnhancedColormapSelector value="viridis" onChange={vi.fn()} />);

    expect(screen.getByText('Viridis')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Select colormap. Current colormap is Viridis' })
    );

    expect(await screen.findByLabelText('Select colormap')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Viridis' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Turbo' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('dispatches colormap selection and closes after choosing a new colormap', async () => {
    const onChange = vi.fn();

    render(<EnhancedColormapSelector value="gray" onChange={onChange} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Select colormap. Current colormap is Grayscale' })
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Turbo' }));

    expect(onChange).toHaveBeenCalledWith('turbo');
    await waitFor(() => {
      expect(screen.queryByLabelText('Select colormap')).not.toBeInTheDocument();
    });
  });

  it('respects the disabled state and does not open the picker', () => {
    render(<EnhancedColormapSelector value="gray" onChange={vi.fn()} disabled />);

    const trigger = screen.getByRole('button', {
      name: 'Select colormap. Current colormap is Grayscale',
    });

    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(screen.queryByLabelText('Select colormap')).not.toBeInTheDocument();
  });
});
