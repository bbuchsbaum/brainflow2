import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { SceneItem } from '@/types/sceneItem';

const { goToPeak } = vi.hoisted(() => ({ goToPeak: vi.fn(async () => {}) }));
vi.mock('@/services/ClusterService', () => ({ getClusterService: () => ({ goToPeak, goToExtremum: vi.fn() }) }));

import { useLayerStore } from '@/stores/layerStore';
import { useClusterStore } from '@/stores/clusterStore';
import { DataSection } from '../DataSection';

const item = (id: string) =>
  ({ id, kind: 'volume-overlay', group: 'volume', name: id, subtitle: '', visible: true, opacity: 1, ref: { type: 'volume', layerId: id } }) as SceneItem;

describe('DataSection · peak at the display threshold (clusters on load)', () => {
  beforeEach(() => {
    goToPeak.mockClear();
    useClusterStore.getState().reset();
    useLayerStore.setState({
      layers: [
        { id: 'z', name: 'p4_zmap', volumeId: 'z', type: 'volume', visible: true, order: 0,
          statistic: { kind: 'z', intentCode: 5, intentParams: [0, 0, 0], intentName: '', dof: [], label: 'z', fromDescription: false, positiveDataLabel: null } },
      ] as never,
      layerMetadata: new Map([['z', { dataRange: { min: -4.75, max: 6.4052 } }]]),
    });
  });

  it('reads "Peak z 6.41 at (−40, −20, 50)" and moves the crosshair there', () => {
    useClusterStore.getState().setPeak('z', { threshold: 3.1, sign: 'both', value: 6.4052, mm: [-40, -20, 50], clusters: 3 });
    render(<DataSection item={item('z')} />);
    const line = screen.getByTestId('layer-peak');
    expect(line.textContent).toBe('Peak z 6.41 at (−40, −20, 50)');
    fireEvent.click(screen.getByRole('button', { name: /Peak/ }));
    expect(goToPeak).toHaveBeenCalledWith('z');
  });

  it('says when nothing passes the threshold', () => {
    useClusterStore.getState().setPeak('z', { threshold: 7, sign: 'both', value: null, mm: null, clusters: 0 });
    render(<DataSection item={item('z')} />);
    expect(screen.getByTestId('layer-peak').textContent).toBe('No voxels with |z| > 7');
  });

  it('follows the sign the clusters were formed with (review)', () => {
    useClusterStore.getState().setPeak('z', { threshold: 7, sign: 'positive', value: null, mm: null, clusters: 0 });
    const { unmount } = render(<DataSection item={item('z')} />);
    expect(screen.getByTestId('layer-peak').textContent).toBe('No voxels with z > 7');
    unmount();
    useClusterStore.getState().setPeak('z', { threshold: 3.1, sign: 'negative', value: null, mm: null, clusters: 0 });
    render(<DataSection item={item('z')} />);
    expect(screen.getByTestId('layer-peak').textContent).toBe('No voxels with z < \u22123.1');
  });

  it('shows nothing before the first run', () => {
    render(<DataSection item={item('z')} />);
    expect(screen.queryByTestId('layer-peak')).toBeNull();
  });
});
