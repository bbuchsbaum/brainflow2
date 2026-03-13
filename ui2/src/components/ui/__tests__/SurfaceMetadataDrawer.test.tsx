import type { ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SurfaceMetadataDrawer } from '../SurfaceMetadataDrawer';
import { useSurfaceStore } from '@/stores/surfaceStore';

vi.mock('@/components/ui/shadcn/sheet', () => ({
  Sheet: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
  SheetContent: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
    <div role="dialog" {...props}>
      {children}
    </div>
  ),
  SheetHeader: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => <div {...props}>{children}</div>,
  SheetTitle: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => <h2 {...props}>{children}</h2>,
  SheetDescription: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => <p {...props}>{children}</p>,
}));

describe('SurfaceMetadataDrawer', () => {
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
      useSurfaceStore.setState({
        surfaces: new Map(),
      });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    act(() => {
      useSurfaceStore.setState({
        surfaces: new Map(),
      });
    });
  });

  it('returns null when the surface is unavailable', () => {
    const { container } = render(
      <SurfaceMetadataDrawer surfaceId="missing" isOpen onOpenChange={vi.fn()} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('shows the intended default sections expanded on first render', () => {
    act(() => {
      useSurfaceStore.setState({
        surfaces: new Map([
          [
            'surface-1',
            {
              handle: 'surface-handle',
              name: 'Left Pial',
              visible: true,
              geometry: {
                vertices: new Float32Array([0, 1, 2, 3, 4, 5]),
                faces: new Uint32Array([0, 1, 2]),
              },
              layers: new Map(),
              metadata: {
                vertexCount: 2,
                faceCount: 1,
                hemisphere: 'left',
                surfaceType: 'pial',
                path: '/tmp/left-pial.gii',
              },
            },
          ],
        ]),
      });
    });

    render(<SurfaceMetadataDrawer surfaceId="surface-1" isOpen onOpenChange={vi.fn()} />);

    expect(screen.getByText('/tmp/left-pial.gii')).toBeInTheDocument();
    expect(screen.getByText('Vertices:')).toBeInTheDocument();
    expect(screen.getByText('Faces:')).toBeInTheDocument();
    expect(screen.queryByText('Geometry Loaded')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Geometry' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('toggles sections and resets copied state after the timer elapses', async () => {
    act(() => {
      useSurfaceStore.setState({
        surfaces: new Map([
          [
            'surface-1',
            {
              handle: 'surface-handle',
              name: 'Right Inflated',
              visible: true,
              geometry: {
                vertices: new Float32Array([0, 1, 2, 3, 4, 5]),
                faces: new Uint32Array([0, 1, 2]),
              },
              layers: new Map(),
              metadata: {
                vertexCount: 2,
                faceCount: 1,
                hemisphere: 'right',
                surfaceType: 'inflated',
                path: '/tmp/right-inflated.gii',
              },
            },
          ],
        ]),
      });
    });

    render(<SurfaceMetadataDrawer surfaceId="surface-1" isOpen onOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Geometry' }));
    expect(screen.getByRole('button', { name: 'Geometry' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Geometry Loaded:')).toBeInTheDocument();

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy Handle' }));
    });

    expect(writeTextMock).toHaveBeenCalledWith('surface-handle');
    expect(screen.getByRole('button', { name: 'Handle copied' })).toHaveAttribute('data-copied', 'true');

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByRole('button', { name: 'Copy Handle' })).toHaveAttribute('data-copied', 'false');
  });
});
