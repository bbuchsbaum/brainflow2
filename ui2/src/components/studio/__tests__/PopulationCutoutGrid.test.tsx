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
    query: { key: 'fixture' },
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
  expect(
    screen
      .getAllByRole('button', { name: /^Focus cutout/ })
      .map((button) => button.getAttribute('aria-label')),
  ).toEqual(['A', 'B', 'C', 'D'].map((id) => `Focus cutout ${id}`));
  expect(container.querySelectorAll('canvas')).toHaveLength(1);
});

it('mirrors axial cutouts under the radiological convention and hovers the same voxel back', async () => {
  const { useViewDisplaySettingsStore } = await import('@/stores/viewDisplaySettingsStore');
  const ctx = {
    drawImage: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  const image = { width: 2, height: 2, close: vi.fn() } as unknown as ImageBitmap;
  // 2 × 2 axial cutout: image (i, j) ↔ world (i, j, 0); values by column.
  const plane = {
    origin_mm: [0, 0, 0] as [number, number, number],
    u_mm: [1, 0, 0] as [number, number, number],
    v_mm: [0, 1, 0] as [number, number, number],
    dim_px: [2, 2] as [number, number],
  };
  const display = {
    query: { key: 'mirror', request: { orientation: 'axial' } },
    data: { cutouts: { plane, members: [{ memberId: 'A', values: [10, 20, 10, 20], validPixels: 4 }] } },
    images: new PopulationImages(image, image, image),
  } as unknown as PopulationSliceDisplay;
  const hover = vi.fn();
  const grid = (
    <PopulationCutoutGrid
      display={display}
      width={105}
      focusedId={null}
      selectedIds={new Set()}
      onFocus={vi.fn()}
      onToggle={vi.fn()}
      onHover={hover}
    />
  );
  useViewDisplaySettingsStore.getState().setRadiological(true);
  try {
    render(grid);
    expect(ctx.scale).toHaveBeenCalledWith(-1, 1);
    // Drawn into its cell from the mirrored origin, not offset.
    expect(ctx.drawImage).toHaveBeenCalledWith(image, 0, 0, 2, 2, 0, 0, 97, 97);
    const cell = screen.getByRole('button', { name: 'Focus cutout A' });
    vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 105, height: 145, right: 105, bottom: 145, x: 0, y: 0, toJSON: () => ({}),
    });
    // The left half on screen shows image column 1 (world x = 1, value 20).
    fireEvent.mouseMove(cell, { clientX: 10, clientY: 10 });
    expect(hover).toHaveBeenLastCalledWith([1, 0, 0]);
    expect(screen.getByText('A: 20.00')).toBeInTheDocument();
  } finally {
    useViewDisplaySettingsStore.getState().setRadiological(false);
  }
  cleanup();
  ctx.scale.mockClear();
  render(grid);
  expect(ctx.scale).not.toHaveBeenCalled();
  const cell = screen.getByRole('button', { name: 'Focus cutout A' });
  vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, width: 105, height: 145, right: 105, bottom: 145, x: 0, y: 0, toJSON: () => ({}),
  });
  fireEvent.mouseMove(cell, { clientX: 10, clientY: 10 });
  expect(hover).toHaveBeenLastCalledWith([0, 0, 0]);
});
