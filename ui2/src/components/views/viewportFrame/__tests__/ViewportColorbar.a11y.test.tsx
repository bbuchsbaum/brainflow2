import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ViewportColorbar } from '../ViewportColorbar';

describe('ViewportColorbar spoken name (v5 fidelity)', () => {
  it('names a guessed statistic in full in its accessible name, never "z*"', () => {
    render(
      <ViewportColorbar
        layer={{
          layerId: 'z',
          name: 'motor_zstat1.nii.gz',
          colormap: 'fmri',
          intensity: [-6, 6],
          threshold: [-2.3, 2.3],
          units: 'z*',
          unitsFromName: true,
          nameLabel: 'motor_zstat1',
        }}
        width={900}
        height={600}
      />,
    );
    const bar = screen.getByRole('img', { name: /^Colorbar for/ });
    const name = bar.getAttribute('aria-label') ?? '';
    expect(name).toContain('z score, inferred from file name');
    expect(name).not.toMatch(/z\*/);
  });
});
