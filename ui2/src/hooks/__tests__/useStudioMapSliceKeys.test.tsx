import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { useStudioMapSliceKeys } from '../useStudioMapSliceKeys';
import { getKeyboardShortcutService } from '@/services/KeyboardShortcutService';

function Map({ step }: { step: (n: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useStudioMapSliceKeys(ref, step);
  return (
    <div ref={ref} data-testid="map">
      <button type="button">inside</button>
    </div>
  );
}

afterEach(() => {
  cleanup();
  getKeyboardShortcutService().destroy();
});

it('steps the Studio map under the pointer, not the workspace view (QA N9)', () => {
  const service = getKeyboardShortcutService();
  service.init();
  const workspaceStep = vi.fn();
  service.register({
    id: 'slice.up',
    key: 'ArrowUp',
    category: 'Slice',
    description: 'workspace',
    priority: 10,
    handler: workspaceStep,
  });
  const step = vi.fn();
  const { getByTestId, getByRole } = render(<Map step={step} />);
  // jsdom has no layout: the map is on screen.
  vi.spyOn(getByTestId('map'), 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);

  // Pointer elsewhere: the workspace view steps.
  fireEvent.keyDown(window, { key: 'ArrowUp' });
  expect(workspaceStep).toHaveBeenCalledTimes(1);
  expect(step).not.toHaveBeenCalled();

  // Pointer over the map: the map steps, twice; shift jumps ten.
  fireEvent.mouseEnter(getByTestId('map'));
  fireEvent.keyDown(window, { key: 'ArrowUp' });
  fireEvent.keyDown(window, { key: 'ArrowUp' });
  fireEvent.keyDown(window, { key: 'ArrowDown', shiftKey: true });
  expect(step.mock.calls.map(([n]) => n)).toEqual([1, 1, -10]);
  expect(workspaceStep).toHaveBeenCalledTimes(1);

  // Pointer gone but focus inside the map: still the map.
  fireEvent.mouseLeave(getByTestId('map'));
  getByRole('button', { name: 'inside' }).focus();
  fireEvent.keyDown(window, { key: 'PageUp' });
  expect(step).toHaveBeenLastCalledWith(10);
  (document.activeElement as HTMLElement).blur();
  fireEvent.keyDown(window, { key: 'ArrowUp' });
  expect(workspaceStep).toHaveBeenCalledTimes(2);
});

it('releases the keys when the hovered map leaves the screen without a pointerleave (review L3)', () => {
  const service = getKeyboardShortcutService();
  service.init();
  const workspaceStep = vi.fn();
  service.register({
    id: 'slice.up',
    key: 'ArrowUp',
    category: 'Slice',
    description: 'workspace',
    priority: 10,
    handler: workspaceStep,
  });
  const step = vi.fn();
  const { getByTestId } = render(<Map step={step} />);
  const map = getByTestId('map');
  // jsdom has no layout: give the map a box while it is "on screen".
  const rects = vi.spyOn(map, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
  fireEvent.mouseEnter(map);
  fireEvent.keyDown(window, { key: 'ArrowUp' });
  expect(step).toHaveBeenCalledTimes(1);
  // ⌘1: the Studio tab is hidden (display: none) under the resting pointer.
  rects.mockReturnValue([] as unknown as DOMRectList);
  fireEvent.keyDown(window, { key: 'ArrowUp' });
  expect(step).toHaveBeenCalledTimes(1);
  expect(workspaceStep).toHaveBeenCalledTimes(1);
});
