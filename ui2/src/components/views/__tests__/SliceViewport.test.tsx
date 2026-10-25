import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SliceViewport } from '../SliceViewport';
import type { RenderContext } from '@/types/renderContext';

const placement = {
  x: 10,
  y: 20,
  width: 200,
  height: 100,
  imageWidth: 100,
  imageHeight: 50,
};

const renderContext: RenderContext = {
  id: 'slice-axial',
  type: 'slice',
  dimensions: { width: 400, height: 200 },
  metadata: { viewType: 'axial' },
};

const viewPlane = {
  origin_mm: [10, 20, 30] as [number, number, number],
  u_mm: [2, 0, 0] as [number, number, number],
  v_mm: [0, -2, 0] as [number, number, number],
  dim_px: [100, 50] as [number, number],
};

const registrationMock = vi.hoisted(() => vi.fn());
const strokeLog = vi.hoisted(() => [] as Array<{ color: string; width: number }>);
const sliceRendererMock = vi.hoisted(() => vi.fn((props: any) => {
  const canvas = document.createElement('canvas');
  canvas.width = props.width;
  canvas.height = props.height;
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
  props.onCanvasReady?.(canvas);
  const ctx: any = {
    strokeStyle: '',
    lineWidth: 1,
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(() => strokeLog.push({ color: ctx.strokeStyle, width: ctx.lineWidth })),
    strokeRect: vi.fn(),
    setLineDash: vi.fn(),
  };
  props.customRender?.(ctx, placement);
  return <canvas data-testid="slice-renderer" width={props.width} height={props.height} />;
}));

vi.mock('../viewport/useRenderContextRegistration', () => ({
  useRenderContextRegistration: registrationMock,
}));

vi.mock('../SliceRenderer', () => ({
  SliceRenderer: sliceRendererMock,
}));

describe('SliceViewport Brainflow adapter', () => {
  it('registers render context and delegates rendering through SliceRenderer', () => {
    render(
      <SliceViewport
        width={400}
        height={200}
        context={renderContext}
        viewPlane={viewPlane}
        showNoLayers
      />
    );

    expect(registrationMock).toHaveBeenCalledWith(renderContext);
    expect(sliceRendererMock).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 400,
        height: 200,
        context: renderContext,
        showNoLayers: true,
      }),
      undefined
    );
  });

  it('keeps Brainflow world-click callback behavior through the reusable viewport', () => {
    const onWorldClick = vi.fn();
    const { container } = render(
      <SliceViewport
        width={400}
        height={200}
        context={renderContext}
        viewPlane={viewPlane}
        onWorldClick={onWorldClick}
      />
    );

    fireEvent.mouseDown(container.firstElementChild as Element, {
      button: 0,
      clientX: 130,
      clientY: 70,
    });

    expect(onWorldClick).toHaveBeenCalledTimes(1);
    expect(onWorldClick.mock.calls[0][0]).toEqual([60, 0, 30]);
  });

  it('draws the crosshair once: dark halo, then the coloured core', () => {
    strokeLog.length = 0;
    render(
      <SliceViewport
        width={400}
        height={300}
        context={renderContext}
        viewPlane={viewPlane}
        crosshair={{ visible: true, world_mm: [60, 0, 30] }}
        crosshairStyle={{ color: '#5fe0a0', lineWidth: 2, lineDash: [6, 6], centerGap: 0 }}
      />
    );

    // Two halo strokes (h + v) then two core strokes; the shared viewer's
    // own crosshair pass is not drawn on top a second time.
    const strokes = strokeLog.slice(0, 4);
    expect(strokeLog.length % 4).toBe(0);
    expect(strokes.map((s) => s.color)).toEqual([
      'rgba(0, 0, 0, 0.6)',
      'rgba(0, 0, 0, 0.6)',
      '#5fe0a0',
      '#5fe0a0',
    ]);
    expect(strokes.map((s) => s.width)).toEqual([4, 4, 2, 2]);
  });

  it('keeps the 2px core in compact views and drops to 1px only below 100px', () => {
    const style = { color: '#5fe0a0', lineWidth: 2, lineDash: [6, 6], centerGap: 0 };
    // 1280x800 main panes (~205px short side) are not compact.
    strokeLog.length = 0;
    render(
      <SliceViewport width={400} height={200} context={renderContext} viewPlane={viewPlane}
        crosshair={{ visible: true, world_mm: [60, 0, 30] }} crosshairStyle={style} />
    );
    expect(strokeLog.slice(0, 4).map((s) => s.width)).toEqual([4, 4, 2, 2]);
    // Compact (Studio cards): shorter dashes, same 2px core and 60% halo.
    strokeLog.length = 0;
    render(
      <SliceViewport width={200} height={120} context={renderContext} viewPlane={viewPlane}
        crosshair={{ visible: true, world_mm: [60, 0, 30] }} crosshairStyle={style} />
    );
    expect(strokeLog.slice(0, 4).map((s) => s.width)).toEqual([4, 4, 2, 2]);
    expect(strokeLog[0].color).toBe('rgba(0, 0, 0, 0.6)');
    // Thumbnails below 100px: 1px core.
    strokeLog.length = 0;
    render(
      <SliceViewport width={200} height={90} context={renderContext} viewPlane={viewPlane}
        crosshair={{ visible: true, world_mm: [60, 0, 30] }} crosshairStyle={style} />
    );
    expect(strokeLog.slice(0, 4).map((s) => s.width)).toEqual([3, 3, 1, 1]);
  });

  it('splits each line around the centre gap (halo and core alike)', () => {
    strokeLog.length = 0;
    render(
      <SliceViewport
        width={400}
        height={300}
        context={renderContext}
        viewPlane={viewPlane}
        crosshair={{ visible: true, world_mm: [60, 0, 30] }}
        crosshairStyle={{ color: '#5fe0a0', lineWidth: 2, lineDash: [6, 6], centerGap: 6 }}
      />
    );
    // One path per axis (both arms, dashes laid out from the gap edge): halo
    // h + v, then core h + v. Gap geometry is covered in crosshairHalo.test.ts.
    expect(strokeLog.slice(0, 4).map((s) => s.width)).toEqual([4, 4, 2, 2]);
  });
});

