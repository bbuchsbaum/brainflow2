import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AtlasRoiPicker } from '../AtlasRoiPicker';
import { atlasRoiService } from '@/services/AtlasRoiService';
import { useLayerStore } from '@/stores/layerStore';
vi.mock('@/services/AtlasRoiService', () => ({
  atlasRoiService: { locations: vi.fn(), focus: vi.fn() },
}));
const rois = [
  { id: 1, name: 'Visual', hemisphere: 'left', network: 'Vis', worldMm: [1, 2, 3], voxelCount: 12 },
  {
    id: 7,
    name: 'Somatomotor',
    hemisphere: 'right',
    network: 'SomMot',
    worldMm: [4, 5, 6],
    voxelCount: 8,
  },
  { id: 9, name: 'Absent', hemisphere: 'left', network: null, worldMm: null, voxelCount: 0 },
];
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(atlasRoiService.locations).mockResolvedValue(rois as never);
  useLayerStore.setState({
    layers: [
      { id: 'atlas', volumeId: 'atlas', name: 'Atlas', type: 'label', visible: true, order: 0 },
    ],
  });
});
describe('ROI navigation', () => {
  it('searches names, selects with keyboard, and focuses the corresponding parcel', async () => {
    const onSelect = vi.fn();
    render(<AtlasRoiPicker layerId="atlas" selectedId={1} onSelect={onSelect} />);
    const search = screen.getByRole('combobox');
    await waitFor(() => expect(search).toBeEnabled());
    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: 'somato' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(7);
    expect(atlasRoiService.focus).toHaveBeenCalledWith('atlas', rois[1]);
  });
  it('numeric ID and Next ROI both navigate; next skips gaps and absent parcels', async () => {
    const onSelect = vi.fn();
    render(<AtlasRoiPicker layerId="atlas" selectedId={1} onSelect={onSelect} />);
    await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Next ROI' }));
    fireEvent.change(screen.getByLabelText('Label ID'), { target: { value: '7' } });
    expect(atlasRoiService.focus).toHaveBeenCalledTimes(2);
    expect(atlasRoiService.focus).toHaveBeenLastCalledWith('atlas', rois[1]);
    fireEvent.change(screen.getByLabelText('Label ID'), { target: { value: '9' } });
    expect(atlasRoiService.focus).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('alert')).toHaveTextContent('no voxels');
  });
});
