import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { SceneItem } from '@/types/sceneItem';

const { goToExtremum } = vi.hoisted(() => ({ goToExtremum: vi.fn(async () => null) }));
vi.mock('@/services/ClusterService', () => ({ getClusterService: () => ({ goToExtremum }) }));

import { useLayerStore } from '@/stores/layerStore';
import { DataSection } from '../DataSection';

const item = (id: string) =>
  ({ id, kind: 'volume-overlay', group: 'volume', name: id, subtitle: '', visible: true, opacity: 1, ref: { type: 'volume', layerId: id } }) as SceneItem;

describe('DataSection · Go to max / min', () => {
  beforeEach(() => {
    goToExtremum.mockClear();
    useLayerStore.setState({
      layers: [
        { id: 'z', name: 'z', volumeId: 'z', type: 'volume', visible: true, order: 0,
          statistic: { kind: 'z', intentCode: 5, intentParams: [0, 0, 0], intentName: '', dof: [], label: 'z', fromDescription: false, positiveDataLabel: null } },
        { id: 't1', name: 't1', volumeId: 't1', type: 'volume', visible: true, order: 1 },
      ] as never,
      layerMetadata: new Map([
        ['z', { dataRange: { min: -4.98, max: 5.97 } }],
        ['t1', { dataRange: { min: 0, max: 255 } }],
      ]),
    });
  });

  it('offers Go to max / min for a statistic layer', () => {
    render(<DataSection item={item('z')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go to max' }));
    fireEvent.click(screen.getByRole('button', { name: 'Go to min' }));
    expect(goToExtremum).toHaveBeenNthCalledWith(1, 'z', 'max');
    expect(goToExtremum).toHaveBeenNthCalledWith(2, 'z', 'min');
  });

  it('does not offer them for a plain image', () => {
    render(<DataSection item={item('t1')} />);
    expect(screen.queryByTestId('extremum-links')).toBeNull();
  });
});
