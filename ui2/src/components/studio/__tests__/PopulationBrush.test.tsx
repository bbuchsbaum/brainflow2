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

it('lassos actual identities and cancels an unfinished polygon on refit', () => {
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
  const { container, rerender } = render(
    <PopulationBrush scope="fit1" lasso>
      <svg>
        <circle data-datum-id="inside" />
        <circle data-datum-id="outside" />
      </svg>
    </PopulationBrush>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Lasso observations' }));
  const surface = screen.getByLabelText('Population brush surface');
  surface.setPointerCapture = vi.fn();
  vi.spyOn(surface.parentElement!, 'getBoundingClientRect').mockReturnValue(bounds(0, 0, 100, 100));
  const circles = container.querySelectorAll('circle');
  vi.spyOn(circles[0], 'getBoundingClientRect').mockReturnValue(bounds(20, 20, 4, 4));
  vi.spyOn(circles[1], 'getBoundingClientRect').mockReturnValue(bounds(80, 20, 4, 4));
  fireEvent.pointerDown(surface, { button: 0, clientX: 10, clientY: 10 });
  for (const [clientX, clientY] of [
    [50, 10],
    [50, 50],
    [10, 50],
  ])
    fireEvent.pointerMove(surface, { clientX, clientY });
  expect(select).not.toHaveBeenCalled();
  fireEvent.pointerUp(surface, { clientX: 10, clientY: 10 });
  expect(select).toHaveBeenCalledExactlyOnceWith(
    ['inside'],
    'replace',
    'map-derived',
    'Spatial relationship lasso',
  );
  fireEvent.pointerDown(surface, { button: 0, clientX: 0, clientY: 0 });
  fireEvent.pointerMove(surface, { clientX: 100, clientY: 100 });
  rerender(
    <PopulationBrush scope="fit2" lasso>
      <svg />
    </PopulationBrush>,
  );
  fireEvent.pointerUp(surface, { clientX: 0, clientY: 0 });
  expect(select).toHaveBeenCalledTimes(1);
});

it('a controlled brush shows no start button; its owner starts it and Finish / Esc end it', () => {
  const onActiveChange = vi.fn();
  const { rerender } = render(
    <PopulationBrush scope="one" horizontal active={false} onActiveChange={onActiveChange}>
      <svg />
    </PopulationBrush>,
  );
  expect(screen.queryByRole('button', { name: 'Brush response plot' })).toBeNull();
  expect(screen.queryByLabelText('Population brush surface')).toBeNull();
  rerender(
    <PopulationBrush scope="one" horizontal active onActiveChange={onActiveChange}>
      <svg />
    </PopulationBrush>,
  );
  const surface = screen.getByLabelText('Population brush surface');
  fireEvent.keyDown(surface, { key: 'Escape' });
  expect(onActiveChange).toHaveBeenLastCalledWith(false);
  fireEvent.click(screen.getByRole('button', { name: 'Finish brushing' }));
  expect(onActiveChange).toHaveBeenCalledTimes(2);
  expect(onActiveChange).toHaveBeenLastCalledWith(false);
});

it('direct mode: a drag selects what it spans, a click passes through, Shift adds, Esc cancels', () => {
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
  const clicked = vi.fn();
  const { container } = render(
    <PopulationBrush scope="one" horizontal direct>
      <svg>
        <circle data-datum-id="B" onClick={clicked} />
        <circle data-datum-id="A" />
      </svg>
    </PopulationBrush>,
  );
  // No mode to enter: no start button, no overlay.
  expect(screen.queryByRole('button', { name: 'Brush response plot' })).toBeNull();
  expect(screen.queryByLabelText('Population brush surface')).toBeNull();
  const host = screen.getByTestId('population-brush-direct');
  host.setPointerCapture = vi.fn();
  host.releasePointerCapture = vi.fn();
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(bounds(0, 0, 100, 100));
  const circles = container.querySelectorAll('circle');
  vi.spyOn(circles[0], 'getBoundingClientRect').mockReturnValue(bounds(20, 20, 4, 4));
  vi.spyOn(circles[1], 'getBoundingClientRect').mockReturnValue(bounds(80, 70, 4, 4));
  // A press that does not move is a click on the dot.
  fireEvent.pointerDown(circles[0], { button: 0, clientX: 22, clientY: 22 });
  fireEvent.pointerUp(circles[0], { clientX: 22, clientY: 22 });
  fireEvent.click(circles[0]);
  expect(clicked).toHaveBeenCalledTimes(1);
  expect(select).not.toHaveBeenCalled();
  // A horizontal drag spans the full height: it takes B, not A.
  fireEvent.pointerDown(host, { button: 0, clientX: 10, clientY: 90 });
  fireEvent.pointerMove(host, { clientX: 40, clientY: 90, buttons: 1 });
  expect(screen.getByTestId('population-brush-rect')).toBeInTheDocument();
  expect(host.setPointerCapture).toHaveBeenCalled();
  fireEvent.pointerUp(host, { clientX: 40, clientY: 90 });
  expect(select).toHaveBeenCalledExactlyOnceWith(['B'], 'replace', 'map-derived', 'Response plot brush');
  expect(screen.queryByTestId('population-brush-rect')).toBeNull();
  // Shift adds.
  fireEvent.pointerDown(host, { button: 0, clientX: 70, clientY: 10, shiftKey: true });
  fireEvent.pointerMove(host, { clientX: 95, clientY: 10, buttons: 1 });
  fireEvent.pointerUp(host, { clientX: 95, clientY: 10 });
  expect(select).toHaveBeenLastCalledWith(['A'], 'union', 'map-derived', 'Response plot brush');
  // Esc cancels a drag in progress, though focus is not in the plot (the
  // wrapper never holds it): the key reaches the window, and goes no further.
  const outer = vi.fn();
  document.addEventListener('keydown', outer);
  fireEvent.pointerDown(host, { button: 0, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(host, { clientX: 60, clientY: 10, buttons: 1 });
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(screen.queryByTestId('population-brush-rect')).toBeNull();
  expect(outer).not.toHaveBeenCalled();
  fireEvent.pointerUp(host, { clientX: 60, clientY: 10 });
  // Its release is not a click on the mark under it.
  fireEvent.click(circles[0]);
  expect(clicked).toHaveBeenCalledTimes(1);
  expect(select).toHaveBeenCalledTimes(2);
  // Without a drag, Escape is left to others.
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(outer).toHaveBeenCalledTimes(1);
  document.removeEventListener('keydown', outer);
  // The click a completed drag's release fires does not also reach the mark.
  fireEvent.pointerDown(circles[0], { button: 0, clientX: 15, clientY: 22 });
  fireEvent.pointerMove(circles[0], { clientX: 40, clientY: 22, buttons: 1 });
  fireEvent.pointerUp(circles[0], { clientX: 40, clientY: 22 });
  fireEvent.click(circles[0]);
  expect(select).toHaveBeenCalledTimes(3);
  expect(clicked).toHaveBeenCalledTimes(1);
  // The next plain click does reach it.
  fireEvent.pointerDown(circles[0], { button: 0, clientX: 22, clientY: 22 });
  fireEvent.pointerUp(circles[0], { clientX: 22, clientY: 22 });
  fireEvent.click(circles[0]);
  expect(clicked).toHaveBeenCalledTimes(2);
  // A move with the button no longer down (released outside the window)
  // ends the drag: nothing applies when a stray release arrives later.
  fireEvent.pointerDown(host, { button: 0, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(host, { clientX: 60, clientY: 10, buttons: 1 });
  expect(screen.getByTestId('population-brush-rect')).toBeInTheDocument();
  fireEvent.pointerMove(host, { clientX: 70, clientY: 10, buttons: 0 });
  expect(screen.queryByTestId('population-brush-rect')).toBeNull();
  expect(host.releasePointerCapture).toHaveBeenCalled();
  fireEvent.pointerUp(host, { clientX: 70, clientY: 10 });
  expect(select).toHaveBeenCalledTimes(3);
});
