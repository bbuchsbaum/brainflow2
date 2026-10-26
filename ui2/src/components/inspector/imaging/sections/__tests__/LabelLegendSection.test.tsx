import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LabelLegendSection } from '../LabelLegendSection';
import { useLayerStore } from '@/stores/layerStore';
import { useStatusBarStore } from '@/stores/statusBarStore';
import type { SceneItem } from '@/types/sceneItem';

const item = {
  id: 'dseg',
  kind: 'volume-overlay-atlas',
  group: 'volume',
  name: 'atlas-synth3_dseg.nii.gz',
  subtitle: '',
  visible: true,
  opacity: 1,
  ref: { type: 'volume', layerId: 'dseg' },
} as SceneItem;

describe('LabelLegendSection', () => {
  beforeEach(() => {
    useLayerStore.setState({
      layers: [
        {
          id: 'dseg',
          name: 'atlas-synth3_dseg.nii.gz',
          volumeId: 'dseg',
          type: 'label',
          visible: true,
          order: 0,
          atlasPaletteLegend: [
            { label_id: 1, roi: 'L_sensorimotor', displayName: 'L_sensorimotor', color: [70, 130, 180] },
            { label_id: 2, roi: 'R_occipitotemporal', displayName: 'R_occipitotemporal', color: [220, 180, 60] },
          ],
        } as never,
      ],
    });
    useStatusBarStore.getState().setValue('region', 'R_occipitotemporal');
  });

  it('lists regions with id and name and marks the one at the crosshair', () => {
    render(<LabelLegendSection item={item} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual(['1L_sensorimotor', '2R_occipitotemporal']);
    expect(rows[1]).toHaveAttribute('aria-current', 'location');
    expect(rows[0]).not.toHaveAttribute('aria-current');
    expect(screen.getByText('Regions (2)')).toBeInTheDocument();
  });

  it('renders nothing without a legend', () => {
    useLayerStore.setState({ layers: [] });
    const { container } = render(<LabelLegendSection item={item} />);
    expect(container).toBeEmptyDOMElement();
  });
});
