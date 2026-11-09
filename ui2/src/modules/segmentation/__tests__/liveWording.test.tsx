import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConstraintStripView } from '@/modules/segmentation/components/shared/ConstraintStripView';
import { NativeSliceRuler, SliceProgress } from '@/modules/segmentation/components/shared/SliceProgress';
import { info } from './liveFixtures';

describe('live tracing wording (QA 2026-11-08)', () => {
  it('states the brush and what it paints over in plain words, without default-only items', () => {
    render(<ConstraintStripView plain label={1} definition={{ name: 'Label 1', color: 'rgb(196 105 46)' }} paintOver="paints over unlocked labels" diameterMm={4} readout="3 pieces on this slice" />);
    const strip = screen.getByTestId('constraint-strip');
    expect(strip).toHaveTextContent('Label 1·brush ⌀ 4.0 mm·paints over unlocked labels·3 pieces on this slice');
    expect(strip).not.toHaveTextContent('2D');
    expect(strip).not.toHaveTextContent('range');
    expect(strip).not.toHaveTextContent('=');
  });
  it('keeps the design strip unchanged when not plain', () => {
    render(<ConstraintStripView label={1} paintOver="over unlocked" diameterMm={3} readout="7 vx" />);
    expect(screen.getByTestId('constraint-strip')).toHaveTextContent('over unlocked·2D·⌀ 3.0 mm= 7 vx·range off');
  });
  it('keys the slice bars next to the chart', () => {
    const snapshot = info().snapshot;
    render(<SliceProgress snapshot={snapshot} activeId={1} current={0} onPick={() => {}} />);
    expect(screen.getByTestId('live-slice-matrix-key')).toHaveTextContent('in progresscompletecheck: gap or area jump');
    expect(screen.queryByText(/Hollow: in progress/)).not.toBeInTheDocument();
  });
  it('scrolls the ruler to the current slice when it changes', () => {
    const snapshot = { ...info().snapshot, dimensions: [5, 40, 7] as [number, number, number] };
    const scroll = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scroll;
    try {
      const view = render(<NativeSliceRuler snapshot={snapshot} activeId={1} current={3} onPick={() => {}} />);
      view.rerender(<NativeSliceRuler snapshot={snapshot} activeId={1} current={30} onPick={() => {}} />);
      expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest' });
      expect(scroll.mock.contexts.at(-1)).toBe(screen.getByRole('button', { name: /Native slice 31,/ }));
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });
});
