/**
 * Utility functions for MosaicView coordinate and page calculations
 */

import type { WorldCoordinates } from '@/types/coordinates';

/**
 * Convert a world position (in mm) to a slice index
 * @param worldPosition - Position in world coordinates (mm) along the axis
 * @param sliceMin - Minimum bound for the axis (mm)
 * @param sliceMax - Maximum bound for the axis (mm)
 * @param totalSlices - Total number of slices along the axis
 * @returns Slice index (0-based)
 */
export function worldPositionToSliceIndex(
  worldPosition: number,
  sliceMin: number,
  sliceMax: number,
  totalSlices: number
): number {
  const sliceRange = sliceMax - sliceMin;
  if (sliceRange === 0) return 0;
  
  const normalizedPosition = (worldPosition - sliceMin) / sliceRange;
  const clampedPosition = Math.max(0, Math.min(1, normalizedPosition));
  return Math.round(clampedPosition * (totalSlices - 1));
}

/**
 * Convert a slice index to the page number containing that slice
 * @param sliceIndex - The slice index (0-based)
 * @param slicesPerPage - Number of slices displayed per page
 * @returns Page number (0-based)
 */
export function sliceIndexToPage(sliceIndex: number, slicesPerPage: number): number {
  if (slicesPerPage <= 0) return 0;
  return Math.floor(sliceIndex / slicesPerPage);
}

/**
 * Get the axis index for world coordinates based on slice axis
 * @param axis - The slice axis ('axial', 'sagittal', or 'coronal')
 * @returns Index into world coordinate array [x, y, z]
 */
export function getAxisIndex(axis: 'axial' | 'sagittal' | 'coronal'): number {
  switch (axis) {
    case 'axial': return 2;    // Z axis
    case 'sagittal': return 0;  // X axis
    case 'coronal': return 1;   // Y axis
  }
}

/**
 * Calculate the initial page for MosaicView based on crosshair position
 * @param crosshairPosition - Current crosshair world coordinates [x, y, z] in mm
 * @param volumeBounds - Volume bounds with min/max arrays
 * @param axis - The slice axis
 * @param totalSlices - Total number of slices
 * @param gridRows - Number of rows in the grid
 * @param gridCols - Number of columns in the grid
 * @returns Initial page number
 */
export function calculateInitialPage(
  crosshairPosition: WorldCoordinates,
  volumeBounds: { min: number[], max: number[] },
  axis: 'axial' | 'sagittal' | 'coronal',
  totalSlices: number,
  gridRows: number,
  gridCols: number
): number {
  const axisIndex = getAxisIndex(axis);
  const worldPosition = crosshairPosition[axisIndex];
  const sliceMin = volumeBounds.min[axisIndex];
  const sliceMax = volumeBounds.max[axisIndex];
  
  const sliceIndex = worldPositionToSliceIndex(
    worldPosition,
    sliceMin,
    sliceMax,
    totalSlices
  );
  
  const slicesPerPage = gridRows * gridCols;
  return sliceIndexToPage(sliceIndex, slicesPerPage);
}

/**
 * Calculate volume center coordinates
 * @param volumeBounds - Volume bounds with min/max arrays
 * @returns Center coordinates [x, y, z] in mm
 */
export function calculateVolumeCenter(
  volumeBounds: { min: number[], max: number[] }
): WorldCoordinates {
  return [
    (volumeBounds.min[0] + volumeBounds.max[0]) / 2,
    (volumeBounds.min[1] + volumeBounds.max[1]) / 2,
    (volumeBounds.min[2] + volumeBounds.max[2]) / 2
  ];
}