/**
 * Native OS file drops (Finder / Explorer) in the desktop app.
 *
 * HTML5 `File` objects carry no path in a webview, so the desktop window keeps
 * Tauri's native drag-drop enabled (`dragDropEnabled` in tauri.conf.json) and
 * this hook turns its drag events into app actions:
 *
 * - dropped folders are mounted in the Files panel;
 * - dropped images are delivered to the drop target under the pointer as a
 *   synthetic `drop` whose `dataTransfer.files` are path-carrying `File`s, so
 *   each view's existing drop handling (overlay, intent, Compare panes) applies;
 * - images dropped where no view accepts them are added as layers;
 * - anything else is reported, not silently ignored.
 *
 * In-app drags no longer use HTML5 drag events for the same reason; see
 * `utils/pointerDrag.ts`.
 */

import { useEffect } from 'react';
import { getEventBus } from '@/events/EventBus';
import { getApiService } from '@/services/apiService';
import { getFileLoadingService } from '@/services/FileLoadingService';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { FILE_DRAG_MIME, serializeFileDragData } from '@/utils/layerDrag';
import {
  SyntheticDragHover,
  createDragDataTransfer,
  createPathFile,
  type ClientPoint,
  type DragModifiers,
} from '@/utils/pointerDrag';
import { safeUnlisten, type Unlisten } from '@/utils/eventUtils';

const LOADABLE_IMAGE_EXTENSIONS = ['.nii', '.nii.gz', '.gii', '.gifti'];

export function isLoadableImagePath(path: string): boolean {
  const lower = path.toLowerCase();
  return LOADABLE_IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/**
 * Convert a Tauri drag position to CSS client coordinates. wry 0.51 reports
 * macOS positions in view points (already CSS pixels) although Tauri types
 * them as physical; on Windows/Linux they are physical pixels.
 */
export function nativeDropPointToClient(
  position: { x: number; y: number },
  env: { isMac: boolean; devicePixelRatio: number },
): ClientPoint {
  if (env.isMac) return { x: position.x, y: position.y };
  const scale = env.devicePixelRatio > 0 ? env.devicePixelRatio : 1;
  return { x: position.x / scale, y: position.y / scale };
}

export interface NativeDropDeps {
  /** Resolves when `path` lists as a directory; rejects otherwise. */
  listDirectory: (path: string) => Promise<unknown>;
  mountDirectory: (path: string) => Promise<void>;
  loadImage: (path: string) => Promise<void>;
  notify: (type: 'warning' | 'error', message: string) => void;
}

export interface NativeDropResult {
  mounted: string[];
  /** Images accepted by the drop target under the pointer. */
  delivered: string[];
  /** Images loaded as layers because no drop target accepted them. */
  loaded: string[];
  rejected: string[];
}

/** Payload for drop targets: path `File`s plus the in-app file MIME. */
export function createNativeDropTransfer(imagePaths: readonly string[]): DataTransfer {
  const first = imagePaths[0];
  const data: Record<string, string> = {};
  if (first) {
    const json = serializeFileDragData({ path: first, name: basename(first), type: 'file' });
    data[FILE_DRAG_MIME] = json;
    data['text/plain'] = first;
  }
  return createDragDataTransfer(data, imagePaths.map(createPathFile));
}

/**
 * Modifier keys held during a native drag. Tauri's drag events carry no
 * modifiers, so this follows window key and pointer events (keys pressed
 * while the window has focus) and resets on blur. While another app (Finder)
 * is frontmost the webview may not see key events; then modifiers read false
 * and the drop uses the default intent.
 */
export class ModifierTracker {
  private state: Required<DragModifiers> = {
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
  };
  private readonly target: Window;

  constructor(target: Window = window) {
    this.target = target;
    target.addEventListener('keydown', this.onEvent, true);
    target.addEventListener('keyup', this.onEvent, true);
    target.addEventListener('pointermove', this.onEvent, true);
    target.addEventListener('pointerdown', this.onEvent, true);
    target.addEventListener('blur', this.reset);
  }

  get(): DragModifiers {
    return { ...this.state };
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onEvent, true);
    this.target.removeEventListener('keyup', this.onEvent, true);
    this.target.removeEventListener('pointermove', this.onEvent, true);
    this.target.removeEventListener('pointerdown', this.onEvent, true);
    this.target.removeEventListener('blur', this.reset);
  }

  private readonly onEvent = (event: Event) => {
    const e = event as KeyboardEvent | MouseEvent;
    this.state = {
      altKey: Boolean(e.altKey),
      shiftKey: Boolean(e.shiftKey),
      metaKey: Boolean(e.metaKey),
      ctrlKey: Boolean(e.ctrlKey),
    };
  };

  private readonly reset = () => {
    this.state = { altKey: false, shiftKey: false, metaKey: false, ctrlKey: false };
  };
}

/**
 * Route one native drop. Folders are mounted; images go to the drop target
 * under `point` (via `hover`), falling back to loading them as layers.
 */
export async function routeNativeDrop(
  paths: readonly string[],
  point: ClientPoint,
  deps: NativeDropDeps,
  hover?: SyntheticDragHover,
  modifiers: DragModifiers = {},
): Promise<NativeDropResult> {
  const result: NativeDropResult = { mounted: [], delivered: [], loaded: [], rejected: [] };
  const images = paths.filter(isLoadableImagePath);
  const others = paths.filter((path) => !isLoadableImagePath(path));

  if (images.length > 0) {
    const tracker = hover ?? new SyntheticDragHover(createNativeDropTransfer(images));
    const accepted = tracker.drop(point, modifiers);
    if (accepted) {
      result.delivered.push(...images);
    } else {
      for (const path of images) {
        await deps.loadImage(path);
        result.loaded.push(path);
      }
    }
  } else {
    hover?.leave();
  }

  for (const path of others) {
    let isDirectory = false;
    try {
      await deps.listDirectory(path);
      isDirectory = true;
    } catch {
      isDirectory = false;
    }
    if (isDirectory) {
      await deps.mountDirectory(path);
      result.mounted.push(path);
    } else {
      result.rejected.push(path);
    }
  }

  if (result.rejected.length > 0) {
    const names = result.rejected.map(basename).join(', ');
    deps.notify(
      'warning',
      `Not opened: ${names}. Drop NIfTI (.nii, .nii.gz) or GIfTI (.gii) files, or a folder.`,
    );
  }
  return result;
}

function defaultDeps(): NativeDropDeps {
  return {
    listDirectory: (path) => getApiService().listDirectory(path, 1),
    mountDirectory: (path) => useFileBrowserStore.getState().mountDirectory(path),
    loadImage: (path) => getFileLoadingService().loadFile(path, 'drag-drop', 'add-layer'),
    notify: (type, message) => getEventBus().emit('ui.notification', { type, message }),
  };
}

function isTauriEnv(): boolean {
  try {
    return typeof window !== 'undefined' && Boolean((window as { __TAURI__?: unknown }).__TAURI__);
  } catch {
    return false;
  }
}

interface DragDropPayload {
  type: 'enter' | 'over' | 'drop' | 'leave';
  paths?: string[];
  position?: { x: number; y: number };
}

/** Install the native drag-drop listener for the app's lifetime (desktop only). */
export function useNativeFileDrop(): void {
  useEffect(() => {
    if (!isTauriEnv()) return;
    let disposed = false;
    let unlisten: Unlisten | null = null;
    let hover: SyntheticDragHover | null = null;
    const modifiers = new ModifierTracker(window);

    const toClient = (position?: { x: number; y: number }): ClientPoint =>
      nativeDropPointToClient(position ?? { x: -1, y: -1 }, {
        isMac: navigator.platform.toLowerCase().includes('mac'),
        devicePixelRatio: window.devicePixelRatio,
      });

    const handle = (payload: DragDropPayload) => {
      switch (payload.type) {
        case 'enter': {
          hover?.leave();
          const images = (payload.paths ?? []).filter(isLoadableImagePath);
          // Folder-only drags show no image-drop overlay.
          hover =
            images.length > 0 ? new SyntheticDragHover(createNativeDropTransfer(images)) : null;
          hover?.move(toClient(payload.position), modifiers.get());
          return;
        }
        case 'over':
          hover?.move(toClient(payload.position), modifiers.get());
          return;
        case 'leave':
          hover?.leave();
          hover = null;
          return;
        case 'drop': {
          const tracker = hover;
          hover = null;
          void routeNativeDrop(
            payload.paths ?? [],
            toClient(payload.position),
            defaultDeps(),
            tracker ?? undefined,
            modifiers.get(),
          ).catch((error) => {
            console.error('[useNativeFileDrop] Drop failed:', error);
          });
          return;
        }
      }
    };

    void (async () => {
      try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview');
        const fn = await getCurrentWebview().onDragDropEvent((event) => {
          handle(event.payload as DragDropPayload);
        });
        if (disposed) void safeUnlisten(fn);
        else unlisten = fn;
      } catch (error) {
        console.warn('[useNativeFileDrop] Native drag-drop unavailable:', error);
      }
    })();

    return () => {
      disposed = true;
      modifiers.dispose();
      hover?.leave();
      void safeUnlisten(unlisten);
    };
  }, []);
}
