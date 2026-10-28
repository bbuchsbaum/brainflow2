import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DisplayRange, OpacityControl, ColormapControl } from '../ImagingControls';

describe('host-neutral imaging controls', () => {
  it.each([false, true])('preserves host range expansion policy: %s', (allowRangeExpansion) => {
    const onChange = vi.fn();
    render(
      <DisplayRange
        label="Range"
        low={-3}
        high={8}
        min={-3}
        max={8}
        allowRangeExpansion={allowRangeExpansion}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Range high/ }));
    const input = screen.getByRole('textbox', { name: 'Range high' });
    fireEvent.change(input, { target: { value: '20' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    if (allowRangeExpansion) expect(onChange).toHaveBeenCalledWith(-3, 20);
    else expect(onChange).not.toHaveBeenCalled();
  });
  it('uses percent stepping and avoids writing unchanged opacity', () => {
    const onChange = vi.fn();
    const { rerender } = render(<OpacityControl value={0.4} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Opacity' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith(0.41);
    onChange.mockClear();
    rerender(<OpacityControl value={0} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Opacity' }), { key: 'Home' });
    expect(onChange).not.toHaveBeenCalled();
  });
  it('offers only host-supported palettes while keeping the native default catalog', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ColormapControl value="viridis" options={['gray', 'viridis', 'hot']} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Select colormap/ }));
    expect(screen.queryByRole('button', { name: 'Magma', exact: true })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Grayscale', exact: true }));
    expect(onChange).toHaveBeenCalledWith('gray');
    rerender(<ColormapControl value="viridis" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /^Select colormap/ }));
    expect(screen.getByRole('button', { name: 'Magma', exact: true })).toBeVisible();
  });
});
