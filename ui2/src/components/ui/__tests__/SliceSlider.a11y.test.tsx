import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SliceSlider } from '../SliceSlider';

describe('SliceSlider accessible name', () => {
  it.each([
    ['axial', 'Axial slice position', 'z = 17.5 mm'],
    ['sagittal', 'Sagittal slice position', 'x = 17.5 mm'],
    ['coronal', 'Coronal slice position', 'y = 17.5 mm'],
  ] as const)('names the %s slider with its world position', (viewType, name, valueText) => {
    render(
      <SliceSlider viewType={viewType} value={17.5} min={-90} max={90} step={0.5} onChange={() => {}} />,
    );
    const slider = screen.getByRole('slider', { name });
    expect(slider).toHaveAttribute('aria-valuetext', valueText);
  });

  it('formats negative and zero positions without a negative zero', () => {
    const { rerender } = render(
      <SliceSlider viewType="sagittal" value={-0.5} min={-90} max={90} step={1} onChange={() => {}} />,
    );
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', 'x = -0.5 mm');
    rerender(<SliceSlider viewType="sagittal" value={-0} min={-90} max={90} step={1} onChange={() => {}} />);
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', 'x = 0.0 mm');
  });
});

describe('SliceSlider keyboard and value semantics', () => {
  it('pages by ten steps and clamps to the range', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SliceSlider viewType="axial" value={10} min={-90} max={90} step={2} onChange={onChange} />,
    );
    const slider = screen.getByRole('slider');
    fireEvent.keyDown(slider, { key: 'PageUp' });
    expect(onChange).toHaveBeenLastCalledWith(30);
    fireEvent.keyDown(slider, { key: 'PageDown' });
    expect(onChange).toHaveBeenLastCalledWith(-10);
    rerender(<SliceSlider viewType="axial" value={85} min={-90} max={90} step={2} onChange={onChange} />);
    fireEvent.keyDown(slider, { key: 'PageUp' });
    expect(onChange).toHaveBeenLastCalledWith(90);
  });

  it('moves exactly one step from an off-grid value; Home/End go to the bounds', () => {
    const onChange = vi.fn();
    render(<SliceSlider viewType="axial" value={17.5} min={-72} max={108} step={2} onChange={onChange} />);
    const slider = screen.getByRole('slider');
    fireEvent.keyDown(slider, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith(19.5);
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith(15.5);
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith(-72);
    fireEvent.keyDown(slider, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith(108);
  });

  it('reports the continuous value (no hidden snapping) and snaps pointer changes to the grid', () => {
    const onChange = vi.fn();
    render(<SliceSlider viewType="axial" value={17.5} min={-72} max={108} step={2} onChange={onChange} />);
    const slider = screen.getByRole('slider') as HTMLInputElement;
    expect(slider).toHaveAttribute('step', 'any');
    expect(slider.value).toBe('17.5');
    expect(slider).toHaveAttribute('aria-valuetext', 'z = 17.5 mm');
    fireEvent.change(slider, { target: { value: '21.3' } });
    expect(onChange).toHaveBeenLastCalledWith(22);
  });
});
