import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PopulationCutoutGrid } from '../PopulationCutoutGrid';
import {
  PopulationImages,
  type PopulationSliceDisplay,
} from '@/services/studio/PopulationSliceService';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('composes one canvas and preserves focus versus selection for actual observation IDs', () => {
  const drawImage = vi.fn(),
    clearRect = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage,
    clearRect,
  } as unknown as CanvasRenderingContext2D);
  const image = { width: 8, height: 2, close: vi.fn() } as unknown as ImageBitmap;
  const plane = {
    origin_mm: [0, 0, 0] as [number, number, number],
    u_mm: [1, 0, 0] as [number, number, number],
    v_mm: [0, 1, 0] as [number, number, number],
    dim_px: [2, 2] as [number, number],
  };
  const members = ['A', 'B', 'C', 'D'].map((memberId, i) => ({
    memberId,
    values: i === 3 ? [null, null, null, null] : [i, 0, null, i],
    validPixels: i === 3 ? 0 : 3,
  }));
  const display = {
    data: { cutouts: { plane, members } },
    images: new PopulationImages(image, image, image),
  } as PopulationSliceDisplay;
  const focus = vi.fn(),
    toggle = vi.fn();
  const { container, rerender } = render(
    <PopulationCutoutGrid
      display={display}
      width={900}
      focusedId="B"
      selectedIds={new Set(['A', 'B'])}
      onFocus={focus}
      onToggle={toggle}
    />,
  );
  expect(container.querySelectorAll('canvas')).toHaveLength(1);
  expect(drawImage).toHaveBeenCalledTimes(4);
  expect(screen.getByRole('button', { name: 'Focus cutout B' })).toHaveAttribute(
    'aria-current',
    'true',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Focus cutout C' }));
  expect(focus).toHaveBeenCalledWith('C');
  expect(toggle).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Focus cutout A' }), { shiftKey: true });
  expect(toggle).toHaveBeenCalledWith('A');
  fireEvent.keyDown(screen.getByRole('button', { name: 'Focus cutout B' }), {
    key: 'Enter',
    shiftKey: true,
  });
  expect(toggle).toHaveBeenLastCalledWith('B');
  expect(screen.getByText('No coverage')).toBeInTheDocument();
  rerender(
    <PopulationCutoutGrid
      display={display}
      width={360}
      focusedId="C"
      selectedIds={new Set(['A'])}
      onFocus={focus}
      onToggle={toggle}
    />,
  );
  expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(
    ['A', 'B', 'C', 'D'].map((id) => `Focus cutout ${id}`),
  );
  expect(container.querySelectorAll('canvas')).toHaveLength(1);
});
