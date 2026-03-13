import type { ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetadataDrawer } from '../MetadataDrawer';
import { useLayerStore } from '@/stores/layerStore';

vi.mock('@/components/ui/shadcn/sheet', () => ({
  Sheet: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
  SheetContent: ({
    children,
    onInteractOutside: _onInteractOutside,
    ...props
  }: { children: ReactNode; onInteractOutside?: unknown; [key: string]: unknown }) => (
    <div role="dialog" {...props}>
      {children}
    </div>
  ),
  SheetHeader: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => <div {...props}>{children}</div>,
  SheetTitle: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => <h2 {...props}>{children}</h2>,
  SheetDescription: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => <p {...props}>{children}</p>,
}));

describe('MetadataDrawer', () => {
  const writeTextMock = vi.fn();

  beforeEach(() => {
    writeTextMock.mockReset();
    writeTextMock.mockResolvedValue(undefined);

    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: writeTextMock,
      },
    });

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

  it('returns null when the layer metadata is unavailable', () => {
    const { container } = render(
      <MetadataDrawer layerId="missing" isOpen onOpenChange={vi.fn()} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('shows the intended default sections expanded on first render', () => {
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
              filePath: '/tmp/t1.nii.gz',
              fileFormat: 'NIfTI',
              dataType: 'Float32',
              dimensions: [64, 64, 36],
              spacing: [1, 1, 1.5],
              orientation: 'RAS+',
              units: 'millimeters',
              dataRange: { min: -1, max: 42.25 },
            },
          ],
        ]),
      });
    });

    render(<MetadataDrawer layerId="layer-1" isOpen onOpenChange={vi.fn()} />);

    expect(screen.getByText('/tmp/t1.nii.gz')).toBeInTheDocument();
    expect(screen.getByText('64 × 64 × 36 voxels')).toBeInTheDocument();
    expect(screen.getByText('1.00 mm × 1.00 mm × 1.50 mm')).toBeInTheDocument();

    expect(screen.queryByText('[-1.00, 42.25]')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Data Statistics' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('toggles collapsed sections and resets copied state after the timer elapses', async () => {
    act(() => {
      useLayerStore.setState({
        layers: [
          {
            id: 'layer-1',
            name: 'Functional Map',
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
              origin: [12.3, -4.5, 6.7],
              dataRange: { min: 0, max: 99.5 },
            },
          ],
        ]),
      });
    });

    render(<MetadataDrawer layerId="layer-1" isOpen onOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Data Statistics' }));
    expect(screen.getByRole('button', { name: 'Data Statistics' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('[0.00, 99.50]')).toBeInTheDocument();

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy Origin' }));
    });

    expect(writeTextMock).toHaveBeenCalledWith('12.3, -4.5, 6.7');
    expect(screen.getByRole('button', { name: 'Origin copied' })).toHaveAttribute('data-copied', 'true');

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByRole('button', { name: 'Copy Origin' })).toHaveAttribute('data-copied', 'false');
  });
});
