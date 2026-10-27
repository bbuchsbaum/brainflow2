import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmptyPane } from '../EmptyPane';

describe('EmptyPane (P3.11)', () => {
  it('shows a title, one hint and at most a primary and a secondary action', () => {
    const open = vi.fn();
    const mount = vi.fn();
    render(
      <EmptyPane
        title="No volume loaded"
        hint="Double-click a file in Files, or drop one on a view."
        primary={{ label: 'Open file…', onClick: open, shortcut: 'Cmd+Shift+O' }}
        secondary={{ label: 'Mount directory', onClick: mount }}
      />,
    );
    expect(screen.getByText('No volume loaded')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Open file…/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Mount directory' }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(mount).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Cmd+Shift+O')).toHaveClass('font-mono');
  });

  it('draws a backdrop behind the message, hidden from assistive tech', () => {
    render(<EmptyPane title="Load a volume to tile its slices" backdrop={<div data-testid="ghost" />} />);
    expect(screen.getByTestId('ghost').parentElement).toHaveAttribute('aria-hidden');
  });
});
