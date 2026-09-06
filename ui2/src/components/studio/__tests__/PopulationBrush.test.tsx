import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PopulationBrush } from '../PopulationBrush';
import { populationProbeActions } from '@/services/studio/PopulationProbeActions';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('commits rendered IDs once on release and cancels without changing membership', () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  const select = vi.spyOn(populationProbeActions, 'select').mockReturnValue({ ok: true });
  const bounds = (x: number, y: number, width: number, height: number) => ({
    x,
    y,
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
    width,
    height,
    toJSON() {},
  });
  const { container } = render(
    <PopulationBrush scope="one" horizontal>
      <svg>
        <circle data-datum-id="B" />
        <circle data-datum-id="A" />
      </svg>
    </PopulationBrush>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Brush response plot' }));
  const surface = screen.getByLabelText('Population brush surface');
  surface.setPointerCapture = vi.fn();
  vi.spyOn(surface.parentElement!, 'getBoundingClientRect').mockReturnValue(bounds(0, 0, 100, 100));
  const circles = container.querySelectorAll('circle');
  vi.spyOn(circles[0], 'getBoundingClientRect').mockReturnValue(bounds(20, 20, 4, 4));
  vi.spyOn(circles[1], 'getBoundingClientRect').mockReturnValue(bounds(80, 20, 4, 4));
  fireEvent.pointerDown(surface, { button: 0, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(surface, { clientX: 40, clientY: 40 });
  expect(select).not.toHaveBeenCalled();
  fireEvent.pointerUp(surface, { clientX: 40, clientY: 40 });
  expect(select).toHaveBeenCalledExactlyOnceWith(
    ['B'],
    'replace',
    'map-derived',
    'Response plot brush',
  );
  fireEvent.pointerDown(surface, { button: 0, clientX: 0, clientY: 0 });
  fireEvent.keyDown(surface, { key: 'Escape' });
  expect(select).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText('Population brush surface')).toBeNull();
});
