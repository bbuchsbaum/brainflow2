import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ThresholdText } from '../ThresholdText';

describe('ThresholdText (spoken form)', () => {
  it('names a guessed statistic in full, never "z star"', () => {
    render(<ThresholdText line="|z*| ≤ 2.3 hidden" variable="z*" />);
    expect(screen.getByRole('img', { name: 'z score, inferred from file name' })).toHaveTextContent('z*');
  });
});
