import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MosaicToolbar } from '../MosaicToolbar';

describe('MosaicToolbar readouts share one "n of m" form', () => {
  it('shows "Slice 49 of 96" and "Page 4 of 6"', () => {
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
      />,
    );
    const text = (container.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('49 of 96');
    expect(text).not.toContain('49/96');
    expect(text).toContain('Page 4 of 6');
    expect(screen.getByRole('group', { name: 'Page 4 of 6' })).toBeInTheDocument();
  });
});
