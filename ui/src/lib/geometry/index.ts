/**
 * Geometry module exports
 */

// Core types
export * from './types';

// Re-export layer types for convenience
export type { VolumeLayer } from '../gpu/layerTypes';

// Array-based vector math (legacy - being phased out)
export * from './vecmath';

// Object-based vector math (new preferred approach)
export { vec3, vec2, mat3, mat4, mat4ToArray } from './vecmathObj';

// ViewFrame utilities (legacy)
export * from './viewFrame';

// ViewFrameExplicit utilities (new preferred approach)
export * from './viewFrameExplicit';

// Re-export commonly used functions for convenience
export { 
  makeFrame, 
  screenToWorld as screenToWorldLegacy, 
  worldToScreen as worldToScreenLegacy,
  resolvePlane as resolvePlaneLegacy,
  calculateFieldOfView as calculateFieldOfViewLegacy
} from './viewFrame';

export {
  makeFrameExplicit,
  frameToGpuVectors,
  screenToWorld,
  worldToScreen,
  pan,
  zoomAroundPoint,
  advanceSlice,
  getCurrentSliceIndex,
  resolvePlane,
  calculateFieldOfView,
  sliceMillimetersToIndex,
  sliceIndexToMillimeters,
  createFrameVersionGenerator
} from './viewFrameExplicit';