import { createRef } from 'react';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SliceRenderer } from '../SliceRenderer';
import { useRenderCanvas } from '@/hooks/useRenderCanvas';

vi.mock('@/hooks/useRenderCanvas', () => ({
  useRenderCanvas: vi.fn(),
}));

describe('SliceRenderer', () => {
  const redrawCanvas = vi.fn();

  beforeEach(() => {
    redrawCanvas.mockReset();

    vi.mocked(useRenderCanvas).mockReturnValue({
      canvasRef: createRef<HTMLCanvasElement>(),
      isLoading: false,
      error: null,
      lastImage: new ImageBitmap(),
      redrawCanvas,
      imagePlacement: null,
    });
  });

  it('redraws retained pixels immediately when the canvas dimensions change', () => {
    const { rerender } = render(
      <SliceRenderer width={256} height={256} viewType="axial" />
    );

    redrawCanvas.mockClear();

    rerender(<SliceRenderer width={320} height={256} viewType="axial" />);

    expect(redrawCanvas).toHaveBeenCalledTimes(1);
  });

  it('keeps canvas display size tied to its render dimensions by default', () => {
    const { container } = render(
      <SliceRenderer width={1024} height={768} viewType="axial" />
    );

    const canvas = container.querySelector('canvas');
    expect(canvas).not.toHaveClass('h-full');
    expect(canvas).not.toHaveClass('w-full');
  });

});
