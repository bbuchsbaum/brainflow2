import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const values: Record<string, number | null> = { t1: 167, z: 5.431, atlas: 1, out: null };
vi.mock('@/hooks/useLayerValueAtWorld', () => ({
  useLayerValueAtWorld: (layerId: string, world: number[]) => ({ layerId, world, value: values[layerId] }),
}));

import { LayerReadoutValue } from '../LayerReadoutValue';
import { useLayerStore } from '@/stores/layerStore';

const Z = {
  kind: 'z' as const,
  intentCode: 5,
  intentParams: [0, 0, 0] as [number, number, number],
  intentName: '',
  dof: [],
  label: 'z',
  fromDescription: false,
  positiveDataLabel: null,
};

describe('LayerReadoutValue', () => {
  beforeEach(() => {
    useLayerStore.setState({
      layers: [
        { id: 't1', name: 'T1', volumeId: 't1', type: 'volume', visible: true, order: 0 },
        { id: 'z', name: 'z', volumeId: 'z', type: 'volume', visible: true, order: 1, statistic: Z },
        {
          id: 'atlas',
          name: 'atlas-synth3_dseg.nii.gz',
          volumeId: 'atlas',
          type: 'label',
          visible: true,
          order: 2,
          atlasPaletteLegend: [{ label_id: 1, roi: 'L_sensorimotor', displayName: 'L_sensorimotor', color: [0, 0, 0] }],
        },
        { id: 'out', name: 'out', volumeId: 'out', type: 'volume', visible: true, order: 3 },
      ] as never,
    });
  });

  const point = { world: [-37.5, -17.5, 50.5] as [number, number, number], source: 'pointer' as const };

  it('reads every layer in its own grammar (fixture truth at voxel 29, 57, 64)', () => {
    render(
      <>
        <LayerReadoutValue layerId="t1" point={point} />
        <LayerReadoutValue layerId="z" point={point} />
        <LayerReadoutValue layerId="atlas" point={point} />
        <LayerReadoutValue layerId="out" point={point} />
      </>,
    );
    expect(screen.getByTestId('layer-readout-t1')).toHaveTextContent(/^167$/);
    expect(screen.getByTestId('layer-readout-z')).toHaveTextContent('z 5.43');
    expect(screen.getByTestId('layer-readout-z').querySelector('i')).toHaveTextContent('z');
    expect(screen.getByTestId('layer-readout-atlas')).toHaveTextContent('L_sensorimotor');
    expect(screen.getByTestId('layer-readout-out')).toHaveTextContent('—');
    expect(screen.getByTestId('layer-readout-z')).toHaveAttribute('title', 'z: z 5.43 at the pointer');
  });
});
