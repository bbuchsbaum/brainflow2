import type { ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetadataPopover } from '../MetadataPopover';
import { useLayerStore } from '@/stores/layerStore';

vi.mock('@/components/ui/shadcn/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <div data-testid="metadata-popover-root">{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({
    children,
    side: _side,
    align: _align,
    sideOffset: _sideOffset,
    collisionPadding: _collisionPadding,
    avoidCollisions: _avoidCollisions,
    ...props
  }: {
    children: ReactNode;
    side?: string;
    align?: string;
    sideOffset?: number;
    collisionPadding?: number;
    avoidCollisions?: boolean;
    [key: string]: unknown;
  }) => <div role="dialog" {...props}>{children}</div>,
  PopoverArrow: () => null,
}));

describe('MetadataPopover', () => {
  const writeTextMock = vi.fn();

  beforeEach(() => {
    writeTextMock.mockReset();
    writeTextMock.mockResolvedValue(undefined);

    act(() => {
      useLayerStore.setState({
        layers: [],
        selectedLayerId: null,
        layerMetadata: new Map(),
        loadingLayers: new Set(),
        errorLayers: new Map(),
      });
    });

    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: writeTextMock,
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    act(() => {
      useLayerStore.setState({
        layers: [],
        selectedLayerId: null,
        layerMetadata: new Map(),
        loadingLayers: new Set(),
        errorLayers: new Map(),
      });
    });
  });

  it('renders children unchanged when layer metadata is missing', () => {
    render(
      <MetadataPopover layerId="missing-layer">
        <button type="button">Open metadata</button>
      </MetadataPopover>
    );

    expect(screen.getByRole('button', { name: 'Open metadata' })).toBeInTheDocument();
    expect(screen.queryByText('Layer Metadata')).not.toBeInTheDocument();
  });

  it('renders formatted metadata for the selected layer when opened', async () => {
    act(() => {
      useLayerStore.setState({
        layers: [
          {
            id: 'layer-1',
            name: 'T1 Anatomical',
            volumeId: 'volume-1',
            type: 'anatomical',
            visible: true,
            order: 0,
          },
        ],
        layerMetadata: new Map([
          [
            'layer-1',
            {
              dimensions: [64, 64, 36],
              spacing: [1, 1, 1.5],
              dataRange: {
                min: -1,
                max: 42.25,
              },
              dataType: 'Float32',
              totalVoxels: 1_500_000,
              nonZeroVoxels: 750_000,
              isBinaryLike: true,
            },
          ],
        ]),
      });
    });

    render(
      <MetadataPopover layerId="layer-1">
        <button type="button">Open metadata</button>
      </MetadataPopover>
    );

    expect(await screen.findByText('T1 Anatomical')).toBeInTheDocument();
    expect(screen.getByText('64 × 64 × 36')).toBeInTheDocument();
    expect(screen.getByText('1.00 mm × 1.00 mm × 1.50 mm')).toBeInTheDocument();
    expect(screen.getByText('[-1.00, 42.25]')).toBeInTheDocument();
    expect(screen.getByText('Float32')).toBeInTheDocument();
    expect(screen.getByText('1.5M voxels (50.0% non-zero)')).toBeInTheDocument();
    expect(screen.getByText('Binary mask detected')).toBeInTheDocument();
  });

  it('copies formatted dimensions and resets the copied state after the timer elapses', async () => {
    act(() => {
      useLayerStore.setState({
        layers: [
          {
            id: 'layer-1',
            name: 'Functional Overlay',
            volumeId: 'volume-1',
            type: 'functional',
            visible: true,
            order: 0,
          },
        ],
        layerMetadata: new Map([
          [
            'layer-1',
            {
              dimensions: [91, 109, 91],
            },
          ],
        ]),
      });
    });

    render(
      <MetadataPopover layerId="layer-1">
        <button type="button">Open metadata</button>
      </MetadataPopover>
    );

    const copyButton = await screen.findByRole('button', { name: 'Copy dimensions' });
    vi.useFakeTimers();

    await act(async () => {
      fireEvent.click(copyButton);
    });

    expect(writeTextMock).toHaveBeenCalledWith('91 × 109 × 91');

    expect(screen.getByRole('button', { name: 'Dimensions copied' })).toHaveAttribute('data-copied', 'true');

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByRole('button', { name: 'Copy dimensions' })).toHaveAttribute('data-copied', 'false');
  });
});
