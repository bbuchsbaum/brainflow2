import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TemporalMetricSelector } from '../TemporalMetricSelector';

describe('TemporalMetricSelector', () => {
  it('names its menu, and a narrow pane keeps the caption for screen readers only (native R4)', () => {
    const { rerender } = render(<TemporalMetricSelector value="none" onChange={() => {}} />);
    expect(screen.getByRole('combobox', { name: 'Temporal:' })).toBeInTheDocument();
    expect(screen.getByText('Temporal:').className).not.toContain('sr-only');
    rerender(<TemporalMetricSelector value="none" onChange={() => {}} compact />);
    expect(screen.getByRole('combobox', { name: 'Temporal:' })).toBeInTheDocument();
    expect(screen.getByText('Temporal:').className).toContain('sr-only');
  });
});
