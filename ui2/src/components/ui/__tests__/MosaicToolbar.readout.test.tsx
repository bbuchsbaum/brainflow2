import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MosaicToolbar } from '../MosaicToolbar';

describe('MosaicToolbar readouts share one "n of m" form', () => {
  it('shows the slice as its world position (no 1-based index) and "Page 4 of 6"', () => {
    const { container } = render(
      <MosaicToolbar
        axis="axial"
        onAxisChange={vi.fn()}
        grid="4x4"
        onGridChange={vi.fn()}
        page={3}
        pageCount={6}
        canPrev
        canNext
        onPrev={vi.fn()}
        onNext={vi.fn()}
        currentSlice={48}
        totalSlices={96}
        onSliceChange={vi.fn()}
        sliceLabel={(i) => `z ${(-77.5 + 2 * i).toFixed(1)}`}
      />,
    );
    const text = (container.textContent ?? '').replace(/\s+/g, ' ');
    // P3 v1 fidelity: a 1-based "49 of 96" beside the 0-based ijk readout
    // was inconsistent; the slider reads the tile label form instead.
    expect(text).toContain('z 18.5');
    expect(text).not.toContain('49 of 96');
    expect(text).toContain('Page 4 of 6');
    expect(screen.getByRole('group', { name: 'Page 4 of 6' })).toBeInTheDocument();
  });
});
