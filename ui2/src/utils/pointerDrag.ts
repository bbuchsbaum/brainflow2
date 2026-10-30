/**
 * Pointer-driven drags that speak the HTML5 drop protocol.
 *
 * With Tauri's native drag-drop enabled (needed to receive real file paths
 * from Finder/Explorer), the webview no longer receives HTML5 drag events:
 * wry's macOS handler claims every NSDragging callback, including drags that
 * start inside the page. In-app drags (file rows, loaded layers) therefore
 * run on pointer events and, at the end, dispatch synthetic `dragenter` /
 * `dragover` / `dragleave` / `drop` events at the element under the pointer.
 * Existing drop targets keep their `onDragOver` / `onDrop` handlers and read
 * the same MIME payloads through a `DataTransfer`-shaped object.
 *
 * Native OS drops (see `useNativeFileDrop`) use the same dispatch, exposing
 * the dropped paths as Electron-style `File` objects with a `path`.
 */

export interface DragModifiers {
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
}

export interface ClientPoint {
  x: number;
  y: number;
}

/** A dropped file that carries its absolute path (Electron/Tauri style). */
export type PathFile = File & { path: string };

/** A minimal `DataTransfer` for synthetic drag events. */
export function createDragDataTransfer(
  data: Record<string, string>,
  files: readonly File[] = [],
): DataTransfer {
  const store = new Map(Object.entries(data));
  const transfer = {
    dropEffect: 'copy',
    effectAllowed: 'copy',
    files: [...files],
    items: [],
    get types() {
      return [...store.keys(), ...(files.length > 0 ? ['Files'] : [])];
    },
    getData: (format: string) => store.get(format) ?? '',
    setData: (format: string, value: string) => {
      store.set(format, value);
    },
    clearData: (format?: string) => {
      if (format) store.delete(format);
      else store.clear();
    },
    setDragImage: () => {},
  };
  return transfer as unknown as DataTransfer;
}

/** Wrap an absolute path as a `File` whose `path` names it. */
export function createPathFile(path: string): PathFile {
  const name = path.split(/[\\/]/).pop() || path;
  const file = new File([], name);
  Object.defineProperty(file, 'path', { value: path, enumerable: true });
  return file as PathFile;
}

/**
 * Dispatch a synthetic drag event at `target`. Returns true when a handler
 * called `preventDefault()` (i.e. a drop target accepted the event).
 */
export function dispatchSyntheticDragEvent(
  type: 'dragenter' | 'dragover' | 'dragleave' | 'drop',
  target: EventTarget,
  point: ClientPoint,
  dataTransfer: DataTransfer,
  modifiers: DragModifiers = {},
): boolean {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: point.x,
    clientY: point.y,
    altKey: Boolean(modifiers.altKey),
    shiftKey: Boolean(modifiers.shiftKey),
    metaKey: Boolean(modifiers.metaKey),
    ctrlKey: Boolean(modifiers.ctrlKey),
  });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

export function elementAtPoint(point: ClientPoint): Element | null {
  if (typeof document === 'undefined') return null;
  if (typeof document.elementFromPoint !== 'function') return null;
  return document.elementFromPoint(point.x, point.y);
}

/**
 * Tracks the element under a moving drag and sends it enter/over/leave, so
 * hover overlays on drop targets behave as they did with HTML5 drags.
 */
export class SyntheticDragHover {
  private current: Element | null = null;

  private readonly dataTransfer: DataTransfer;

  constructor(dataTransfer: DataTransfer) {
    this.dataTransfer = dataTransfer;
  }

  move(point: ClientPoint, modifiers: DragModifiers = {}): Element | null {
    const hit = elementAtPoint(point);
    if (hit !== this.current) {
      // A leave reported outside every rect clears container-level overlays
      // that only reset when the pointer leaves their bounds.
      if (this.current) {
        dispatchSyntheticDragEvent(
          'dragleave',
          this.current,
          { x: -1, y: -1 },
          this.dataTransfer,
          modifiers,
        );
      }
      this.current = hit;
      if (hit) {
        dispatchSyntheticDragEvent('dragenter', hit, point, this.dataTransfer, modifiers);
      }
    }
    if (hit) {
      dispatchSyntheticDragEvent('dragover', hit, point, this.dataTransfer, modifiers);
    }
    return hit;
  }

  /**
   * Drop at `point`; returns true when a drop target accepted it. As in
   * HTML5, the drop goes only to an element whose `dragover` at this point
   * was accepted (`preventDefault`); otherwise the hover just ends.
   */
  drop(point: ClientPoint, modifiers: DragModifiers = {}): boolean {
    const hit = elementAtPoint(point);
    if (this.current && this.current !== hit) this.leave(modifiers);
    if (!hit) return false;
    this.current = hit;
    const accepts = dispatchSyntheticDragEvent(
      'dragover',
      hit,
      point,
      this.dataTransfer,
      modifiers,
    );
    if (!accepts) {
      this.leave(modifiers);
      return false;
    }
    this.current = null;
    return dispatchSyntheticDragEvent('drop', hit, point, this.dataTransfer, modifiers);
  }

  leave(modifiers: DragModifiers = {}): void {
    if (!this.current) return;
    dispatchSyntheticDragEvent(
      'dragleave',
      this.current,
      { x: -1, y: -1 },
      this.dataTransfer,
      modifiers,
    );
    this.current = null;
  }
}

/** Movement (px) before a press becomes a drag, so clicks stay clicks. */
export const DRAG_THRESHOLD_PX = 4;

export interface PointerDragOptions {
  /** MIME → payload exposed to drop targets via `dataTransfer.getData`. */
  data: Record<string, string>;
  /** Text shown next to the pointer while dragging. */
  label: string;
  /** Called once when the drag actually starts (threshold crossed). */
  onStart?: () => void;
  /** Called once when the press ends, whether or not it became a drag. */
  onEnd?: (dropped: boolean) => void;
}

let activeDragCleanup: (() => void) | null = null;

/**
 * Begin tracking a press as a potential drag. Call from `onPointerDown`.
 * Only primary-button presses start a drag; the press stays a normal click
 * until the pointer moves past `DRAG_THRESHOLD_PX`.
 */
export function beginPointerDrag(
  event: PointerEvent | React.PointerEvent,
  options: PointerDragOptions,
): void {
  if (event.button !== 0 || event.isPrimary === false) return;
  if (typeof document === 'undefined') return;
  activeDragCleanup?.();

  const doc = document;
  const start = { x: event.clientX, y: event.clientY };
  const dataTransfer = createDragDataTransfer(options.data);
  const hover = new SyntheticDragHover(dataTransfer);
  let dragging = false;
  let ghost: HTMLElement | null = null;
  let finished = false;

  const modifiersOf = (e: PointerEvent | KeyboardEvent): DragModifiers => ({
    altKey: e.altKey,
    shiftKey: e.shiftKey,
    metaKey: e.metaKey,
    ctrlKey: e.ctrlKey,
  });

  const placeGhost = (point: ClientPoint) => {
    if (!ghost) return;
    ghost.style.transform = `translate(${point.x + 12}px, ${point.y + 8}px)`;
  };

  const onMove = (e: PointerEvent) => {
    // The press ended without a pointerup reaching us (released outside the
    // window, lost to a native menu): end the drag instead of trailing it.
    if (typeof e.buttons === 'number' && (e.buttons & 1) === 0) {
      cancel();
      return;
    }
    const point = { x: e.clientX, y: e.clientY };
    if (!dragging) {
      if (Math.hypot(point.x - start.x, point.y - start.y) < DRAG_THRESHOLD_PX) {
        return;
      }
      dragging = true;
      doc.body.classList.add('bf-pointer-dragging');
      ghost = doc.createElement('div');
      ghost.className = 'bf-drag-ghost';
      ghost.setAttribute('aria-hidden', 'true');
      ghost.textContent = options.label;
      doc.body.appendChild(ghost);
      options.onStart?.();
    }
    e.preventDefault();
    placeGhost(point);
    hover.move(point, modifiersOf(e));
  };

  const finish = (dropped: boolean) => {
    if (finished) return;
    finished = true;
    doc.removeEventListener('pointermove', onMove, true);
    doc.removeEventListener('pointerup', onUp, true);
    doc.removeEventListener('pointercancel', onCancel, true);
    doc.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', onCancel);
    ghost?.remove();
    ghost = null;
    doc.body.classList.remove('bf-pointer-dragging');
    if (activeDragCleanup === cancel) activeDragCleanup = null;
    options.onEnd?.(dropped);
  };

  const onUp = (e: PointerEvent) => {
    if (!dragging) {
      finish(false);
      return;
    }
    const dropped = hover.drop({ x: e.clientX, y: e.clientY }, modifiersOf(e));
    finish(dropped);
  };

  const cancel = () => {
    if (dragging) hover.leave();
    finish(false);
  };
  const onCancel = () => cancel();
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && dragging) {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  };

  doc.addEventListener('pointermove', onMove, true);
  doc.addEventListener('pointerup', onUp, true);
  doc.addEventListener('pointercancel', onCancel, true);
  doc.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', onCancel);
  activeDragCleanup = cancel;
}
