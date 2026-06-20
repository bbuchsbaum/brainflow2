import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReusableSliceViewport, SliceViewerImageSurface } from '../index';

describe('SliceViewerImageSurface', () => {
  it('draws an ImageBitmap and rerenders overlays when dimensions change', async () => {
    const image = new ImageBitmap();
    image.width = 320;
    image.height = 160;
    const customRender = vi.fn();
    const onImageReceived = vi.fn();

    const { rerender } = render(
      <ReusableSliceViewport
        width={400}
        height={200}
        renderSurface={(surfaceProps) => (
          <SliceViewerImageSurface
            {...surfaceProps}
            image={image}
            onImageReceived={onImageReceived}
          />
        )}
        customRender={customRender}
      />
    );

    await waitFor(() => expect(customRender).toHaveBeenCalledTimes(1));
    expect(customRender.mock.calls[0][1]).toMatchObject({
      x: 0,
      y: 0,
      width: 400,
      height: 200,
      imageWidth: 320,
      imageHeight: 160,
    });
    expect(onImageReceived).toHaveBeenCalledWith(image);

    rerender(
      <ReusableSliceViewport
        width={200}
        height={200}
        renderSurface={(surfaceProps) => (
          <SliceViewerImageSurface
            {...surfaceProps}
            image={image}
            onImageReceived={onImageReceived}
          />
        )}
        customRender={customRender}
      />
    );

    await waitFor(() => expect(customRender).toHaveBeenCalledTimes(2));
    expect(customRender.mock.calls[1][1]).toMatchObject({
      x: 0,
      y: 50,
      width: 200,
      height: 100,
    });
  });

  it('renders caller-provided render-state fallbacks without app-store dependencies', () => {
    render(
      <ReusableSliceViewport
        width={128}
        height={128}
        renderSurface={(surfaceProps) => (
          <SliceViewerImageSurface
            {...surfaceProps}
            image={null}
            emptyFallback={<div data-testid="empty-state" />}
          />
        )}
      />
    );

    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
  });
});
