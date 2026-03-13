import { describe, expect, it } from 'vitest';
import {
  formatVolumeDataRange,
  formatVolumeDimensions,
  formatVolumeSpacing,
  formatVolumeVoxelSummary,
} from '../metadataFormatting';

describe('metadataFormatting', () => {
  it('formats volume dimensions, spacing, and data range', () => {
    const metadata = {
      dimensions: [64, 64, 36] as [number, number, number],
      spacing: [2, 2, 2.5] as [number, number, number],
      dataRange: {
        min: -1.2345,
        max: 98.7654,
      },
    };

    expect(formatVolumeDimensions(metadata)).toBe('64 × 64 × 36');
    expect(formatVolumeSpacing(metadata)).toBe('2.00 mm × 2.00 mm × 2.50 mm');
    expect(formatVolumeDataRange(metadata)).toBe('[-1.23, 98.77]');
  });

  it('formats voxel summary when total and non-zero voxel counts are present', () => {
    expect(
      formatVolumeVoxelSummary({
        totalVoxels: 12_500_000,
        nonZeroVoxels: 6_250_000,
      })
    ).toBe('12.5M voxels (50.0% non-zero)');

    expect(
      formatVolumeVoxelSummary({
        totalVoxels: 12_500_000,
      })
    ).toBe('12.5M voxels');

    expect(formatVolumeVoxelSummary({})).toBeNull();
  });
});
