/**
 * The Image header shows the file's own datatype and scaling (QA §3.4: a
 * scaled int16 file read "Data type f32", the in-memory type).
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

const header = vi.hoisted(() => ({
  filename: 'scaled_i16.nii',
  dimensions: [2, 2, 2],
  voxel_spacing: [2, 2, 2] as [number, number, number],
  data_type: 'f32',
  storage: {
    datatype: 'int16',
    bitpix: 16,
    scl_slope: Math.fround(0.1),
    scl_inter: 0,
    cal_min: 0,
    cal_max: 0,
  },
  voxel_to_world: [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1],
  world_bounds_min: [0, 0, 0] as [number, number, number],
  world_bounds_max: [2, 2, 2] as [number, number, number],
  sform_code: 1,
  qform_code: 1,
  orientation_string: 'RAS',
  spatial_units: 'mm',
  temporal_units: null,
  tr_seconds: null,
  num_timepoints: null,
  description: '',
  data_range: { min: 0.5, max: 100 },
}));

vi.mock('@/services/apiService', () => ({
  getApiService: () => ({ getNiftiHeaderInfo: vi.fn(async () => header) }),
}));

import { ImageHeaderDialog } from '../ImageHeaderDialog';
import { storageFacts } from '@/utils/headerStorage';

const rows = (facts: ReturnType<typeof storageFacts>) => facts.map((f) => [f.label, f.value]);

describe('Image header storage', () => {
  it('lists the on-disk datatype, bitpix and scaling, then the in-memory type', () => {
    expect(rows(storageFacts(header))).toEqual([
      ['Data type', 'int16'],
      ['Bits per voxel', '16'],
      ['Loaded as', 'f32'],
      ['Scale slope', '0.1'],
      ['Scale intercept', '0'],
    ]);
  });

  it('adds calibration only when set, and says when there is no scaling', () => {
    const facts = rows(
      storageFacts({
        data_type: 'u8',
        storage: {
          datatype: 'uint8',
          bitpix: 8,
          scl_slope: 0,
          scl_inter: 0,
          cal_min: -1,
          cal_max: 255,
        },
      }),
    );
    expect(facts).toContainEqual(['Scale slope', '0 (no scaling)']);
    expect(facts).toContainEqual(['Calibration', '−1 to 255']);
  });

  it('falls back to the in-memory type when the header cannot be re-read', () => {
    expect(rows(storageFacts({ data_type: 'f32' }))).toEqual([['Data type', 'f32']]);
  });

  it('renders the stored type in the dialog', async () => {
    render(<ImageHeaderDialog open onClose={() => {}} volumeId="vol" />);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('int16');
    expect(within(dialog).getByText('Scale slope')).toBeInTheDocument();
    expect(within(dialog).getByText('0.1')).toBeInTheDocument();
  });
});
