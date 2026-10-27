import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorOverlay } from '../RenderOverlays';

describe('ErrorOverlay', () => {
  it('renders nothing without an error', () => {
    const { container } = render(<ErrorOverlay error={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('uses a dark scrim with a danger title and primary-text body', () => {
    render(<ErrorOverlay error={new Error('GPU device lost')} />);
    const alert = screen.getByRole('alert');
    // A translucent destructive fill under light text fails AA over tissue.
    expect(alert.className).not.toMatch(/bg-destructive/);
    expect(alert.className).toMatch(/bg-black\/\[0\.85\]/);
    expect(screen.getByText('Render error').className).toMatch(/text-bf-danger/);
    expect(screen.getByText('GPU device lost').className).toMatch(/text-bf-text-primary/);
  });
});
