import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SliceSlider } from '../SliceSlider';

// jsdom has no PointerEvent: give pointer events their MouseEvent fields (button, clientX).
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = PointerEventPolyfill;
}

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
    // bf Slider rail: the thumb is the role="slider" (no native input, so no
    // step="any" attribute); aria-valuenow carries the unsnapped value.
    const onChange = vi.fn();
    render(<SliceSlider viewType="axial" value={17.5} min={-72} max={108} step={2} onChange={onChange} />);
    const slider = screen.getByRole('slider');
    expect(slider).toHaveAttribute('aria-valuenow', '17.5');
    expect(slider).toHaveAttribute('aria-valuetext', 'z = 17.5 mm');
    const box = slider.parentElement as HTMLElement; // data-slider-box
    box.getBoundingClientRect = () =>
      ({ left: 0, width: 180, top: 0, height: 24, right: 180, bottom: 24, x: 0, y: 0, toJSON() {} }) as DOMRect;
    const strip = box.parentElement as HTMLElement;
    // x = 93.3 px of 180 -> 21.3 mm -> snapped to the 2 mm grid anchored at -72 -> 22.
    fireEvent.pointerDown(strip, { clientX: 93.3, button: 0, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(22);
    fireEvent.pointerUp(strip, { clientX: 93.3, pointerId: 1 });
  });

  it('marks dragSourceStore only for pointer drags and commits the gesture value', async () => {
    const { useDragSourceStore } = await import('@/stores/dragSourceStore');
    const onCommit = vi.fn();
    const { rerender } = render(
      <SliceSlider viewType="axial" value={0} min={-90} max={90} step={2} onChange={() => {}} onCommit={onCommit} />,
    );
    const slider = screen.getByRole('slider');
    slider.focus();
    expect(useDragSourceStore.getState().draggingSource).toBeNull();
    const box = slider.parentElement as HTMLElement;
    box.getBoundingClientRect = () =>
      ({ left: 0, width: 180, top: 0, height: 24, right: 180, bottom: 24, x: 0, y: 0, toJSON() {} }) as DOMRect;
    const strip = box.parentElement as HTMLElement;
    fireEvent.pointerDown(strip, { clientX: 150, button: 0, pointerId: 1 });
    expect(useDragSourceStore.getState().draggingSource).toBe('slider');
    rerender(
      <SliceSlider viewType="axial" value={60} min={-90} max={90} step={2} onChange={() => {}} onCommit={onCommit} />,
    );
    fireEvent.pointerUp(strip, { clientX: 150, pointerId: 1 });
    expect(useDragSourceStore.getState().draggingSource).toBeNull();
    expect(onCommit).toHaveBeenCalledWith(60);
  });
});
