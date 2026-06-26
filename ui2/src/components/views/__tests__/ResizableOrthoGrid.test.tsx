/**
 * ResizableOrthoGrid — drag-resize logic.
 *
 * jsdom does no layout, so getBoundingClientRect is mocked to a fixed size; the
 * test then drives a mousedown on a gutter + a window mousemove and asserts the
 * grid track fractions change. This proves the resize math + event wiring
 * independent of pixel-perfect hit-testing in the real app.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';

import { ResizableOrthoGrid } from '../ResizableOrthoGrid';

function firstMinmaxFr(template: string): number {
  const m = template.match(/minmax\(0,\s*([\d.]+)fr\)/);
  if (!m) throw new Error(`no minmax fr in: ${template}`);
  return parseFloat(m[1]);
}

describe('ResizableOrthoGrid drag-resize', () => {
  let rectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 600,
      height: 400,
      top: 0,
      left: 0,
      right: 600,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
  });

  afterEach(() => {
    rectSpy.mockRestore();
  });

  it('dragging the vertical (sag|cor) gutter shrinks the sagittal column', () => {
    const { getByTestId } = render(
      <ResizableOrthoGrid
        arrangement="grid"
        axial={<div data-testid="ax" />}
        sagittal={<div data-testid="sg" />}
        coronal={<div data-testid="co" />}
      />,
    );

    const gutter = getByTestId('ortho-gutter-grid-col');
    const gridEl = gutter.parentElement as HTMLElement;
    const before = firstMinmaxFr(gridEl.style.gridTemplateColumns);
    expect(before).toBeCloseTo(1, 5);

    // Drag the gutter 100px to the left → the sagittal (first) column shrinks.
    fireEvent.mouseDown(gutter, { clientX: 300, clientY: 200 });
    fireEvent.mouseMove(window, { clientX: 200, clientY: 200 });
    fireEvent.mouseUp(window);

    const after = firstMinmaxFr(gridEl.style.gridTemplateColumns);
    expect(after).toBeLessThan(before);
  });

  it('dragging the horizontal (axial|bottom) gutter shrinks the top row', () => {
    const { getByTestId } = render(
      <ResizableOrthoGrid
        arrangement="grid"
        axial={<div />}
        sagittal={<div />}
        coronal={<div />}
      />,
    );

    const gutter = getByTestId('ortho-gutter-grid-row');
    const gridEl = gutter.parentElement as HTMLElement;
    const before = firstMinmaxFr(gridEl.style.gridTemplateRows);

    // Drag up 80px → the axial (top) row shrinks.
    fireEvent.mouseDown(gutter, { clientX: 300, clientY: 200 });
    fireEvent.mouseMove(window, { clientX: 300, clientY: 120 });
    fireEvent.mouseUp(window);

    const after = firstMinmaxFr(gridEl.style.gridTemplateRows);
    expect(after).toBeLessThan(before);
  });

  it('clamps a column to the minimum fraction when dragged past the edge', () => {
    const { getByTestId } = render(
      <ResizableOrthoGrid arrangement="row" axial={<div />} sagittal={<div />} coronal={<div />} />,
    );

    const gutter = getByTestId('ortho-gutter-row-0');
    const gridEl = gutter.parentElement as HTMLElement;

    // Drag far past the left edge — the first column clamps, never goes <= 0.
    fireEvent.mouseDown(gutter, { clientX: 200, clientY: 200 });
    fireEvent.mouseMove(window, { clientX: -500, clientY: 200 });
    fireEvent.mouseUp(window);

    const after = firstMinmaxFr(gridEl.style.gridTemplateColumns);
    expect(after).toBeGreaterThan(0);
  });
});
