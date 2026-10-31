import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import {
  ReusableSliceViewport,
  SliceViewerImageSurface,
  type SliceViewerPlacement,
} from '@/components/views/sliceViewer';
import { projectWorldToCanvas } from '@brainflow/visualization/slice';
import { mirrorsView } from '@/stores/viewDisplaySettingsStore';

// A 10 × 10 axial raster on a 100 × 100 canvas: image (i, j) ↔ world (i, −j, 0).
const plane = {
  origin_mm: [0, 0, 0] as [number, number, number],
  u_mm: [1, 0, 0] as [number, number, number],
  v_mm: [0, -1, 0] as [number, number, number],
  dim_px: [10, 10] as [number, number],
};
const image = { width: 10, height: 10 } as ImageBitmap;
const drawImage = vi.fn();

function pane(mirrorX: boolean) {
  const onWorldClick = vi.fn();
  let placement: SliceViewerPlacement | null = null;
  const view = render(
    <ReusableSliceViewport
      width={100}
      height={100}
      viewPlane={plane}
      crosshair={{ visible: true, world_mm: [2, -3, 0] }}
      onWorldClick={onWorldClick}
      onPlacementChange={(next) => {
        placement = next;
      }}
      renderSurface={(props) => <SliceViewerImageSurface {...props} image={image} mirrorX={mirrorX} />}
    />,
  );
  const canvas = view.container.querySelector('canvas')!;
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}),
  });
  return { view, onWorldClick, placement: () => placement };
}

describe('Studio panes under the radiological convention', () => {
  beforeEach(() => {
    drawImage.mockClear();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      drawImage,
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      setLineDash: vi.fn(),
      strokeRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('mirrors axial and coronal only', () => {
    expect(mirrorsView('axial', true)).toBe(true);
    expect(mirrorsView('coronal', true)).toBe(true);
    expect(mirrorsView('sagittal', true)).toBe(false);
    expect(mirrorsView('axial', false)).toBe(false);
  });

  it('a mirrored pane draws flipped and maps a click back to the same world point', () => {
    const plain = pane(false);
    expect(plain.placement()?.mirrorX).toBeFalsy();
    fireEvent.mouseDown(plain.view.container.firstChild as Element, { clientX: 20, clientY: 30, button: 0 });
    expect(plain.onWorldClick.mock.calls[0][0]).toEqual([2, -3, 0]);
    cleanup();

    const mirrored = pane(true);
    const placement = mirrored.placement()!;
    expect(placement.mirrorX).toBe(true);
    // The world point the crosshair marks is drawn at the mirrored column…
    expect(projectWorldToCanvas([2, -3, 0], plane, placement)).toEqual({ canvasX: 80, canvasY: 30 });
    // …and a click there maps back to that same world point.
    fireEvent.mouseDown(mirrored.view.container.firstChild as Element, { clientX: 80, clientY: 30, button: 0 });
    expect(mirrored.onWorldClick.mock.calls[0][0]).toEqual([2, -3, 0]);
  });
});
