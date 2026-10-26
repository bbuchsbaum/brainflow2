import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MosaicTileLabel } from '../MosaicFrame';

describe('MosaicTileLabel', () => {
  it('labels the tile with its slice position in mm, U+2212 minus', () => {
    render(<MosaicTileLabel axis="axial" position={-9.5} atCrosshair={false} />);
    expect(screen.getByTestId('mosaic-tile-label')).toHaveTextContent('z −9.5');
  });

  it('wears the crosshair colour on the crosshair tile', () => {
    render(<MosaicTileLabel axis="sagittal" position={42.5} atCrosshair />);
    const label = screen.getByTestId('mosaic-tile-label');
    expect(label).toHaveTextContent('x 42.5');
    expect(label).toHaveAttribute('data-at-crosshair', 'true');
    expect(label.style.color).not.toBe('');
  });

  it('renders nothing without a position', () => {
    const { container } = render(<MosaicTileLabel axis="axial" position={null} atCrosshair={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
