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
  props.customRender?.({
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    setLineDash: vi.fn(),
  }, placement);
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
});
