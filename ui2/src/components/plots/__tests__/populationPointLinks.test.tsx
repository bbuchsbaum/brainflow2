import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PlotEncoder } from '../encoder/PlotEncoder';
import type { SampleFrame, ResolvedPlotSpec } from '@/plotting';

afterEach(cleanup);
const frame: SampleFrame = {
  columns: [
    { name: 'member', role: 'nominal' },
    { name: 'value', role: 'quantitative' },
  ],
  rows: [
    { member: 'S01', value: 2 },
    { member: 'S02', value: null },
    { member: 'S03', value: -1 },
  ],
};
const spec: ResolvedPlotSpec = {
  mark: 'point',
  encoding: { x: 'member', y: 'value' },
  transforms: [],
  params: {},
};

describe('population point links', () => {
  it('keeps row identity across missing values and separates focus from selection', () => {
    const onFocus = vi.fn();
    const onToggleSelection = vi.fn();
    render(
      <PlotEncoder
        frame={frame}
        spec={spec}
        width={500}
        height={160}
        context={{
          datumLink: {
            idColumn: 'member',
            focusedId: 'S01',
            selectedIds: new Set(['S01']),
            onFocus,
            onToggleSelection,
          },
        }}
      />,
    );
    const third = screen.getByRole('button', { name: 'S03: -1' });
    fireEvent.click(third);
    expect(onFocus).toHaveBeenCalledWith('S03');
    expect(onToggleSelection).not.toHaveBeenCalled();
    fireEvent.click(third, { shiftKey: true });
    expect(onToggleSelection).toHaveBeenCalledWith('S03');
    fireEvent.keyDown(third, { key: 'Enter' });
    expect(onFocus).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(third, { key: ' ', shiftKey: true });
    expect(onToggleSelection).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'S01: 2' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.queryByRole('button', { name: /S02/ })).toBeNull();
  });
});
