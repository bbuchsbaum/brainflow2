/**
 * One precision rule for data range and voxel size in the Inspector Data card
 * and the Image header (utils/valueFormat formatDataRange / formatVoxelSize).
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { formatDataRange, formatVoxelSize } from '@/utils/valueFormat';

const header = vi.hoisted(() => ({
  filename: 'MNI152_T1_2mm.nii.gz',
  dimensions: [96, 114, 96],
  voxel_spacing: [2, 2, 2] as [number, number, number],
  data_type: 'UINT8',
  voxel_to_world: [2, 0, 0, -95.5, 0, 2, 0, -131.5, 0, 0, 2, -77.5, 0, 0, 0, 1],
  world_bounds_min: [-95.5, -131.5, -77.5] as [number, number, number],
  world_bounds_max: [94.5, 94.5, 112.5] as [number, number, number],
  sform_code: 4,
  qform_code: 4,
  orientation_string: 'RAS',
  spatial_units: 'mm',
  temporal_units: null,
  tr_seconds: null,
  num_timepoints: null,
  description: '',
  data_range: { min: 0, max: 255 },
}));

vi.mock('@/services/apiService', () => ({
  getApiService: () => ({ getNiftiHeaderInfo: vi.fn(async () => header) }),
}));

import { ImageHeaderDialog } from '../ImageHeaderDialog';
import { DataSection } from '@/components/inspector/imaging/sections/DataSection';
import { useLayerStore } from '@/stores/layerStore';
import type { SceneItem } from '@/types/sceneItem';

describe('formatDataRange / formatVoxelSize', () => {
  it('auto precision range with U+2212, fixed-2 voxel size', () => {
    expect(formatDataRange(0, 255)).toBe('0 to 255');
    expect(formatDataRange(-4.5812, 6.153)).toBe('−4.58 to 6.15');
    expect(formatVoxelSize([2, 2, 2])).toBe('2.00 × 2.00 × 2.00');
    expect(formatVoxelSize([0.9375, 0.9375, 1.2, 1])).toBe('0.94 × 0.94 × 1.20');
  });
});

describe('Inspector Data card and Image header agree', () => {
  it('shows "0 to 255" and "2.00 × 2.00 × 2.00 mm" in both', async () => {
    useLayerStore.setState({
      layers: [{ id: 'mni', name: 'MNI', volumeId: 'vol-mni', type: 'volume' } as any],
      layerMetadata: new Map([
        [
          'mni',
          { dimensions: [96, 114, 96], dataRange: { min: 0, max: 255 }, spacing: [2, 2, 2] } as any,
        ],
      ]),
    });
    const item = {
      id: 'mni',
      kind: 'volume-base',
      group: 'volume',
      name: 'MNI',
      subtitle: 'base volume',
      visible: true,
      opacity: 1,
      ref: { type: 'volume', layerId: 'mni' },
    } as SceneItem;

    const card = render(<DataSection item={item} />);
    const cardText = card.container.textContent ?? '';
    expect(cardText).toContain('0 to 255');
    expect(cardText).toMatch(/2\.00 × 2\.00 × 2\.00\s*mm/);
    card.unmount();

    render(<ImageHeaderDialog open onClose={() => {}} volumeId="vol-mni" />);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('0 to 255');
    const text = dialog.textContent ?? '';
    expect(text).toContain('2.00 × 2.00 × 2.00');
    expect(text).not.toContain('255.0000');
    expect(text).not.toContain('2.0000 ×');
  });
});
