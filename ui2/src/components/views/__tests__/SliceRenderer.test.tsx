import { createRef } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
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

  it('loads every file of a multi-file OS drop, in order', async () => {
    const onFileDrop = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <SliceRenderer width={64} height={64} viewType="axial" enableDragDrop onFileDrop={onFileDrop} />
    );
    const files = [new File([], 'a.nii'), new File([], 'b.nii')];

    fireEvent.drop(container.firstElementChild!, {
      dataTransfer: { files, getData: () => '', dropEffect: 'none' },
    });

    await waitFor(() => expect(onFileDrop).toHaveBeenCalledTimes(2));
    expect(onFileDrop.mock.calls.map(([f, intent]) => [f.name, intent])).toEqual([
      ['a.nii', 'add-layer'],
      ['b.nii', 'add-layer'],
    ]);
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
