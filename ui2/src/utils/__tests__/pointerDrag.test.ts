import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import {
  SyntheticDragHover,
  beginPointerDrag,
  createDragDataTransfer,
  createPathFile,
  dispatchSyntheticDragEvent,
} from '../pointerDrag';

// jsdom has no PointerEvent: give pointer events their MouseEvent fields (button, clientX).
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = PointerEventPolyfill;
}

function stubElementFromPoint(target: Element | null) {
  const original = document.elementFromPoint;
  document.elementFromPoint = () => target;
  return () => {
    document.elementFromPoint = original;
  };
}

function dropTarget() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const events: Array<{ type: string; transfer: DataTransfer; x: number }> = [];
  for (const type of ['dragenter', 'dragover', 'dragleave', 'drop']) {
    el.addEventListener(type, (event) => {
      const drag = event as DragEvent;
      events.push({ type, transfer: drag.dataTransfer!, x: drag.clientX });
      if (type === 'drop' || type === 'dragover') event.preventDefault();
    });
  }
  return { el, events };
}

describe('pointerDrag', () => {
  let restore: (() => void) | null = null;
  afterEach(() => {
    restore?.();
    restore = null;
    document.body.innerHTML = '';
    document.body.className = '';
  });

  it('exposes MIME data and path-carrying files through a DataTransfer shape', () => {
    const file = createPathFile('/data/sub-01/T1w.nii.gz');
    expect(file.name).toBe('T1w.nii.gz');
    expect(file.path).toBe('/data/sub-01/T1w.nii.gz');

    const transfer = createDragDataTransfer({ 'text/plain': 'hello' }, [file]);
    expect(transfer.getData('text/plain')).toBe('hello');
    expect(transfer.getData('missing')).toBe('');
    expect(Array.from(transfer.files)).toEqual([file]);
    expect(transfer.types).toEqual(['text/plain', 'Files']);
  });

  it('dispatches a cancelable, bubbling drop that reports acceptance', () => {
    const { el, events } = dropTarget();
    const child = document.createElement('span');
    el.appendChild(child);
    const transfer = createDragDataTransfer({ a: '1' });

    const accepted = dispatchSyntheticDragEvent('drop', child, { x: 5, y: 6 }, transfer, {
      shiftKey: true,
    });
    expect(accepted).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0].transfer.getData('a')).toBe('1');

    const ignored = document.createElement('div');
    document.body.appendChild(ignored);
    expect(dispatchSyntheticDragEvent('drop', ignored, { x: 0, y: 0 }, transfer)).toBe(false);
  });

  it('hover sends enter/over to the element under the point and leave when it changes', () => {
    const a = dropTarget();
    const b = dropTarget();
    const hover = new SyntheticDragHover(createDragDataTransfer({}));

    restore = stubElementFromPoint(a.el);
    hover.move({ x: 1, y: 1 });
    hover.move({ x: 2, y: 2 });
    expect(a.events.map((e) => e.type)).toEqual(['dragenter', 'dragover', 'dragover']);

    restore();
    restore = stubElementFromPoint(b.el);
    hover.move({ x: 50, y: 50 });
    // The leave is reported outside every rect so container overlays reset.
    expect(a.events.at(-1)).toMatchObject({ type: 'dragleave', x: -1 });
    expect(b.events.map((e) => e.type)).toEqual(['dragenter', 'dragover']);

    expect(hover.drop({ x: 50, y: 50 })).toBe(true);
    expect(b.events.at(-1)?.type).toBe('drop');
  });

  it('a press without movement stays a click: no drag, no drop', () => {
    const { el, events } = dropTarget();
    restore = stubElementFromPoint(el);
    const source = document.createElement('div');
    document.body.appendChild(source);
    const onStart = vi.fn();
    const onEnd = vi.fn();
    source.addEventListener('pointerdown', (event) =>
      beginPointerDrag(event as PointerEvent, { data: {}, label: 'x', onStart, onEnd }),
    );

    fireEvent.pointerDown(source, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(document, { clientX: 11, clientY: 11, buttons: 1 });
    fireEvent.pointerUp(document, { clientX: 11, clientY: 11 });

    expect(onStart).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledWith(false);
    expect(events).toHaveLength(0);
  });

  it('a drag past the threshold shows a ghost, drops the payload and cleans up', () => {
    const { el, events } = dropTarget();
    restore = stubElementFromPoint(el);
    const source = document.createElement('div');
    document.body.appendChild(source);
    const onStart = vi.fn();
    const onEnd = vi.fn();
    source.addEventListener('pointerdown', (event) =>
      beginPointerDrag(event as PointerEvent, {
        data: { 'text/plain': '/data/a.nii' },
        label: 'a.nii',
        onStart,
        onEnd,
      }),
    );

    fireEvent.pointerDown(source, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(document, { clientX: 30, clientY: 30, buttons: 1 });
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.bf-drag-ghost')?.textContent).toBe('a.nii');
    expect(document.body.classList.contains('bf-pointer-dragging')).toBe(true);

    fireEvent.pointerUp(document, { clientX: 30, clientY: 30, shiftKey: true });
    const drop = events.find((e) => e.type === 'drop');
    expect(drop?.transfer.getData('text/plain')).toBe('/data/a.nii');
    expect(onEnd).toHaveBeenCalledWith(true);
    expect(document.querySelector('.bf-drag-ghost')).toBeNull();
    expect(document.body.classList.contains('bf-pointer-dragging')).toBe(false);
  });

  it('Escape cancels a drag without dropping', () => {
    const { el, events } = dropTarget();
    restore = stubElementFromPoint(el);
    const source = document.createElement('div');
    document.body.appendChild(source);
    const onEnd = vi.fn();
    source.addEventListener('pointerdown', (event) =>
      beginPointerDrag(event as PointerEvent, { data: {}, label: 'x', onEnd }),
    );

    fireEvent.pointerDown(source, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(document, { clientX: 20, clientY: 0, buttons: 1 });
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.pointerUp(document, { clientX: 20, clientY: 0 });

    expect(events.map((e) => e.type)).not.toContain('drop');
    expect(events.at(-1)?.type).toBe('dragleave');
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledWith(false);
  });

  it('does not drop on an element that did not accept the dragover', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const seen: string[] = [];
    for (const type of ['dragover', 'dragleave', 'drop']) {
      el.addEventListener(type, () => seen.push(type)); // never preventDefault
    }
    restore = stubElementFromPoint(el);
    const hover = new SyntheticDragHover(createDragDataTransfer({}));
    hover.move({ x: 1, y: 1 });

    expect(hover.drop({ x: 1, y: 1 })).toBe(false);
    expect(seen).not.toContain('drop');
    expect(seen.at(-1)).toBe('dragleave');
  });

  function startDrag(onEnd: ReturnType<typeof vi.fn>) {
    const { el, events } = dropTarget();
    restore = stubElementFromPoint(el);
    const source = document.createElement('div');
    document.body.appendChild(source);
    source.addEventListener('pointerdown', (event) =>
      beginPointerDrag(event as PointerEvent, { data: {}, label: 'x', onEnd }),
    );
    fireEvent.pointerDown(source, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(document, { clientX: 20, clientY: 0, buttons: 1 });
    expect(document.querySelector('.bf-drag-ghost')).not.toBeNull();
    return events;
  }

  it('ends the drag when a move arrives with the primary button already released', () => {
    const onEnd = vi.fn();
    const events = startDrag(onEnd);
    fireEvent.pointerMove(document, { clientX: 30, clientY: 0, buttons: 0 });

    expect(onEnd).toHaveBeenCalledWith(false);
    expect(document.querySelector('.bf-drag-ghost')).toBeNull();
    expect(events.map((e) => e.type)).not.toContain('drop');
    // A later release does nothing more.
    fireEvent.pointerUp(document, { clientX: 30, clientY: 0 });
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('ends the drag when the window loses focus', () => {
    const onEnd = vi.fn();
    startDrag(onEnd);
    window.dispatchEvent(new Event('blur'));

    expect(onEnd).toHaveBeenCalledWith(false);
    expect(document.querySelector('.bf-drag-ghost')).toBeNull();
    expect(document.body.classList.contains('bf-pointer-dragging')).toBe(false);
  });

  it('ignores secondary-button presses', () => {
    const source = document.createElement('div');
    document.body.appendChild(source);
    const onEnd = vi.fn();
    source.addEventListener('pointerdown', (event) =>
      beginPointerDrag(event as PointerEvent, { data: {}, label: 'x', onEnd }),
    );
    fireEvent.pointerDown(source, { button: 2, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(document, { clientX: 0, clientY: 0 });
    expect(onEnd).not.toHaveBeenCalled();
  });
});
