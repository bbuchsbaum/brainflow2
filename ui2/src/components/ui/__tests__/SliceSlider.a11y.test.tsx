import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SliceSlider } from '../SliceSlider';

describe('SliceSlider accessible name', () => {
  it.each([
    ['axial', 'Axial slice position', 'z = 17.5 mm'],
    ['sagittal', 'Sagittal slice position', 'x = 17.5 mm'],
    ['coronal', 'Coronal slice position', 'y = 17.5 mm'],
  ] as const)('names the %s slider with its world position', (viewType, name, valueText) => {
    render(
      <SliceSlider viewType={viewType} value={17.5} min={-90} max={90} step={0.5} onChange={() => {}} />,
    );
    const slider = screen.getByRole('slider', { name });
    expect(slider).toHaveAttribute('aria-valuetext', valueText);
  });
});
