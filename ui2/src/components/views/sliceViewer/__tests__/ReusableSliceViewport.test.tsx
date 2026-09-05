import { useEffect, useRef } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReusableSliceViewport, type SliceViewerSurfaceProps } from '../index';

const plane = {
  origin_mm: [10, 20, 30] as [number, number, number],
  u_mm: [2, 0, 0] as [number, number, number],
  v_mm: [0, -2, 0] as [number, number, number],
  dim_px: [100, 50] as [number, number],
};

const placement = {
  x: 10,
  y: 20,
  width: 200,
  height: 100,
  imageWidth: 100,
  imageHeight: 50,
};

function mockContext() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    setLineDash: vi.fn(),
    strokeStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
}

function TestSurface({
  width,
  height,
  customRender,
  onCanvasReady,
  ctx,
}: SliceViewerSurfaceProps & { ctx: CanvasRenderingContext2D }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 100,
        top: 50,
        width: 200,
        height: 100,
        right: 300,
        bottom: 150,
        x: 100,
        y: 50,
        toJSON: () => ({}),
      }),
    });
    onCanvasReady(canvas);
    customRender(ctx, placement);
  }, [customRender, ctx, onCanvasReady]);

  return <canvas data-testid="slice-surface" ref={ref} width={width} height={height} />;
}

describe('ReusableSliceViewport', () => {
  it('draws slice border and crosshair through the injected render surface', async () => {
    const ctx = mockContext();
    const onPlacementChange = vi.fn();

    render(
      <ReusableSliceViewport
        width={400}
        height={200}
        viewPlane={plane}
        crosshair={{ visible: true, world_mm: [60, 0, 30] }}
        crosshairStyle={{ color: '#fff', lineWidth: 2, lineDash: [2, 2] }}
        showSliceBorder
        sliceBorderWidth={3}
        onPlacementChange={onPlacementChange}
        renderSurface={(surfaceProps) => <TestSurface {...surfaceProps} ctx={ctx} />}
      />
    );

    await waitFor(() => expect(onPlacementChange).toHaveBeenCalledWith(placement));

    expect(ctx.strokeRect).toHaveBeenCalledWith(11.5, 21.5, 197, 97);
    expect(ctx.setLineDash).toHaveBeenCalledWith([2, 2]);
    expect(ctx.moveTo).toHaveBeenCalledWith(10, 40);
    expect(ctx.lineTo).toHaveBeenCalledWith(210, 40);
    expect(ctx.moveTo).toHaveBeenCalledWith(60, 20);
    expect(ctx.lineTo).toHaveBeenCalledWith(60, 120);
  });

  it('redraws moved or hidden crosshairs without a new image or canvas size', async () => {
    const ctx = mockContext();
    const style = { color: '#fff', lineWidth: 2, lineDash: [] };
    const surface = (props: SliceViewerSurfaceProps) => <TestSurface {...props} ctx={ctx} />;
    const { rerender } = render(<ReusableSliceViewport width={400} height={200} viewPlane={plane}
      crosshair={{ visible: true, world_mm: [60, 0, 30] }} crosshairStyle={style} renderSurface={surface} />);
    await waitFor(() => expect(ctx.moveTo).toHaveBeenCalledWith(60, 20));
    vi.mocked(ctx.moveTo).mockClear();
    rerender(<ReusableSliceViewport width={400} height={200} viewPlane={plane}
      crosshair={{ visible: true, world_mm: [80, 0, 30] }} crosshairStyle={style} renderSurface={surface} />);
    await waitFor(() => expect(ctx.moveTo).toHaveBeenCalledWith(80, 20));
    vi.mocked(ctx.moveTo).mockClear();
    rerender(<ReusableSliceViewport width={400} height={200} viewPlane={plane}
      crosshair={{ visible: false, world_mm: [80, 0, 30] }} crosshairStyle={style} renderSurface={surface} />);
    expect(ctx.moveTo).not.toHaveBeenCalled();
  });

  it('maps primary-button clicks inside the placement to world coordinates', async () => {
    const ctx = mockContext();
    const onWorldClick = vi.fn();
    const { container } = render(
      <ReusableSliceViewport
        width={400}
        height={200}
        viewPlane={plane}
        onWorldClick={onWorldClick}
        renderSurface={(surfaceProps) => <TestSurface {...surfaceProps} ctx={ctx} />}
      />
    );

    await waitFor(() => expect(container.querySelector('canvas')).toBeTruthy());

    fireEvent.mouseDown(container.firstElementChild as Element, {
      button: 0,
      clientX: 130,
      clientY: 70,
    });

    expect(onWorldClick).toHaveBeenCalledTimes(1);
    expect(onWorldClick.mock.calls[0][0]).toEqual([60, 0, 30]);
  });

  it('passes dimensions to the injected render surface on resize', () => {
    const ctx = mockContext();
    const renderSurface = vi.fn((surfaceProps: SliceViewerSurfaceProps) => (
      <TestSurface {...surfaceProps} ctx={ctx} />
    ));
    const { rerender } = render(
      <ReusableSliceViewport
        width={400}
        height={200}
        renderSurface={renderSurface}
      />
    );

    rerender(
      <ReusableSliceViewport
        width={512}
        height={256}
        renderSurface={renderSurface}
      />
    );

    expect(renderSurface).toHaveBeenLastCalledWith(
      expect.objectContaining({ width: 512, height: 256 })
    );
  });
});
