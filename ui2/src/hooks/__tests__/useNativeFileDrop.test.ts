import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement, createRef } from 'react';
import { render, waitFor } from '@testing-library/react';
import {
  ModifierTracker,
  createNativeDropTransfer,
  isLoadableImagePath,
  nativeDropPointToClient,
  routeNativeDrop,
  type NativeDropDeps,
} from '../useNativeFileDrop';
import { FILE_DRAG_MIME, parseFileDragData } from '@/utils/layerDrag';
import { SyntheticDragHover } from '@/utils/pointerDrag';
import { SliceRenderer } from '@/components/views/SliceRenderer';

vi.mock('@/hooks/useRenderCanvas', () => ({
  useRenderCanvas: () => ({
    canvasRef: createRef<HTMLCanvasElement>(),
    isLoading: false,
    error: null,
    lastImage: null,
    redrawCanvas: () => {},
    imagePlacement: null,
  }),
}));

function deps(directories: string[] = []): NativeDropDeps & {
  [K in keyof NativeDropDeps]: ReturnType<typeof vi.fn>;
} {
  return {
    listDirectory: vi.fn((path: string) =>
      directories.includes(path)
        ? Promise.resolve([])
        : Promise.reject(new Error('not a directory')),
    ),
    mountDirectory: vi.fn(() => Promise.resolve()),
    loadImage: vi.fn(() => Promise.resolve()),
    notify: vi.fn(),
  } as never;
}

function stubElementFromPoint(target: Element | null) {
  const original = document.elementFromPoint;
  document.elementFromPoint = () => target;
  return () => {
    document.elementFromPoint = original;
  };
}

describe('native file drop routing', () => {
  let restore: (() => void) | null = null;
  afterEach(() => {
    restore?.();
    restore = null;
    document.body.innerHTML = '';
  });

  it('classifies loadable images by extension', () => {
    expect(isLoadableImagePath('/a/oblique.nii.gz')).toBe(true);
    expect(isLoadableImagePath('/a/T1.NII')).toBe(true);
    expect(isLoadableImagePath('/a/lh.pial.surf.gii')).toBe(true);
    expect(isLoadableImagePath('/a/notes.txt')).toBe(false);
    expect(isLoadableImagePath('/a/folder')).toBe(false);
  });

  it('maps Tauri drag positions to client pixels (points on macOS, physical elsewhere)', () => {
    expect(
      nativeDropPointToClient({ x: 300, y: 200 }, { isMac: true, devicePixelRatio: 2 }),
    ).toEqual({
      x: 300,
      y: 200,
    });
    expect(
      nativeDropPointToClient({ x: 300, y: 200 }, { isMac: false, devicePixelRatio: 2 }),
    ).toEqual({
      x: 150,
      y: 100,
    });
  });

  it('delivers images to the drop target under the pointer as path-carrying files', async () => {
    const view = document.createElement('div');
    document.body.appendChild(view);
    let received: DataTransfer | null = null;
    view.addEventListener('dragover', (event) => event.preventDefault());
    view.addEventListener('drop', (event) => {
      received = (event as DragEvent).dataTransfer;
      event.preventDefault();
    });
    restore = stubElementFromPoint(view);
    const d = deps();

    const result = await routeNativeDrop(
      ['/data/browser/oblique.nii.gz', '/data/lh.white.gii'],
      { x: 10, y: 10 },
      d,
    );

    expect(result.delivered).toEqual(['/data/browser/oblique.nii.gz', '/data/lh.white.gii']);
    const files = Array.from(received!.files) as Array<File & { path: string }>;
    expect(files.map((f) => f.path)).toEqual([
      '/data/browser/oblique.nii.gz',
      '/data/lh.white.gii',
    ]);
    expect(files[0].name).toBe('oblique.nii.gz');
    expect(parseFileDragData(received!.getData(FILE_DRAG_MIME))?.path).toBe(
      '/data/browser/oblique.nii.gz',
    );
    expect(d.loadImage).not.toHaveBeenCalled();
    expect(d.notify).not.toHaveBeenCalled();
  });

  it('loads images as layers when no drop target accepts them', async () => {
    const panel = document.createElement('div'); // e.g. the Files panel: no drop handler
    document.body.appendChild(panel);
    restore = stubElementFromPoint(panel);
    const d = deps();

    const result = await routeNativeDrop(['/data/T1w.nii'], { x: 1, y: 1 }, d);

    expect(result.loaded).toEqual(['/data/T1w.nii']);
    expect(d.loadImage).toHaveBeenCalledWith('/data/T1w.nii');
  });

  it('mounts dropped folders and reports unsupported files', async () => {
    restore = stubElementFromPoint(null);
    const d = deps(['/data/test-data']);

    const result = await routeNativeDrop(
      ['/data/test-data', '/data/readme.txt'],
      { x: 1, y: 1 },
      d,
    );

    expect(result.mounted).toEqual(['/data/test-data']);
    expect(d.mountDirectory).toHaveBeenCalledWith('/data/test-data');
    expect(result.rejected).toEqual(['/data/readme.txt']);
    expect(d.notify).toHaveBeenCalledWith('warning', expect.stringContaining('readme.txt'));
    expect(d.loadImage).not.toHaveBeenCalled();
  });

  it('uses the hover tracker from the drag so the hovered target gets its leave', async () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    document.body.append(a, b);
    const events: string[] = [];
    a.addEventListener('dragleave', () => events.push('a:leave'));
    b.addEventListener('dragover', (event) => event.preventDefault());
    b.addEventListener('drop', (event) => {
      events.push('b:drop');
      event.preventDefault();
    });
    const hover = new SyntheticDragHover(createNativeDropTransfer(['/x.nii']));
    restore = stubElementFromPoint(a);
    hover.move({ x: 1, y: 1 });
    restore();
    restore = stubElementFromPoint(b);

    await routeNativeDrop(['/x.nii'], { x: 5, y: 5 }, deps(), hover);
    expect(events).toEqual(['a:leave', 'b:drop']);
  });

  it('tracks modifier keys from window key events and clears them on blur', () => {
    const tracker = new ModifierTracker(window);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true }));
    expect(tracker.get()).toMatchObject({ shiftKey: true, altKey: false });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true, metaKey: true }));
    expect(tracker.get()).toMatchObject({ shiftKey: false, altKey: true, metaKey: true });
    window.dispatchEvent(new Event('blur'));
    expect(tracker.get()).toMatchObject({ shiftKey: false, altKey: false, metaKey: false });
    tracker.dispose();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true }));
    expect(tracker.get().shiftKey).toBe(false);
  });

  it.each([
    [{}, 'add-layer'],
    [{ shiftKey: true }, 'comparison'],
    [{ altKey: true }, 'new-workspace'],
  ] as const)(
    'a native drop with modifiers %o reaches resolveDropOpenIntent as %s',
    async (modifiers, intent) => {
      const onFileDrop = vi.fn();
      const { container } = render(
        createElement(SliceRenderer, {
          width: 64,
          height: 64,
          viewType: 'axial',
          enableDragDrop: true,
          onFileDrop,
        }),
      );
      restore = stubElementFromPoint(container.firstElementChild);

      const result = await routeNativeDrop(['/data/T1w.nii'], { x: 5, y: 5 }, deps(), undefined, modifiers);

      expect(result.delivered).toEqual(['/data/T1w.nii']);
      await waitFor(() => expect(onFileDrop).toHaveBeenCalledTimes(1));
      expect(onFileDrop.mock.calls[0][1]).toBe(intent);
    },
  );
});
