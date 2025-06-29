/**
 * ViewFrame utilities with explicit scale separation
 */
import type { ViewFrameExplicit, VolumeMeta, Plane, Vec3, Vec2, UVec2 } from './types';
import { vec3, vec2 } from './vecmathObj';

// Standard anatomical planes
const AXIAL_NORMAL: Vec3 = { x: 0, y: 0, z: 1 };
const AXIAL_UP: Vec3 = { x: 0, y: 1, z: 0 };

const CORONAL_NORMAL: Vec3 = { x: 0, y: 1, z: 0 };
const CORONAL_UP: Vec3 = { x: 0, y: 0, z: -1 };

const SAGITTAL_NORMAL: Vec3 = { x: 1, y: 0, z: 0 };
const SAGITTAL_UP: Vec3 = { x: 0, y: 0, z: -1 };

/** 
 * Create a unique frame version generator for each viewer instance
 */
export function createFrameVersionGenerator() {
  let counter = 0;
  return () => ++counter;
}

/**
 * Resolve plane specification to normal and up vectors
 */
export function resolvePlane(plane: Plane): { normal: Vec3; up: Vec3 } {
  if (typeof plane === 'string') {
    switch (plane) {
      case 'axial':
        return { normal: AXIAL_NORMAL, up: AXIAL_UP };
      case 'coronal':
        return { normal: CORONAL_NORMAL, up: CORONAL_UP };
      case 'sagittal':
        return { normal: SAGITTAL_NORMAL, up: SAGITTAL_UP };
    }
  }
  // Custom plane - ensure orthonormal
  const normal = vec3.normalize(plane.normal);
  const up = vec3.normalize(vec3.sub(
    plane.up,
    vec3.scale(normal, vec3.dot(plane.up, normal))
  ));
  return { normal, up };
}

/**
 * Convert slice position from mm to voxel index
 */
export function sliceMillimetersToIndex(
  slice_mm: number,
  meta: VolumeMeta,
  normal: Vec3
): number {
  // For axis-aligned planes, use exact axis
  if (Math.abs(normal.x) > 0.9) {
    return (slice_mm - meta.origin.x) / meta.spacing.x;
  } else if (Math.abs(normal.y) > 0.9) {
    return (slice_mm - meta.origin.y) / meta.spacing.y;
  } else if (Math.abs(normal.z) > 0.9) {
    return (slice_mm - meta.origin.z) / meta.spacing.z;
  }
  
  // For oblique planes, use average spacing
  const avgSpacing = (Math.abs(meta.spacing.x) + 
                     Math.abs(meta.spacing.y) + 
                     Math.abs(meta.spacing.z)) / 3;
  return slice_mm / avgSpacing;
}

/**
 * Convert slice index to mm position
 */
export function sliceIndexToMillimeters(
  index: number,
  meta: VolumeMeta,
  normal: Vec3
): number {
  if (Math.abs(normal.x) > 0.9) {
    return meta.origin.x + index * meta.spacing.x;
  } else if (Math.abs(normal.y) > 0.9) {
    return meta.origin.y + index * meta.spacing.y;
  } else if (Math.abs(normal.z) > 0.9) {
    return meta.origin.z + index * meta.spacing.z;
  }
  
  const avgSpacing = (Math.abs(meta.spacing.x) + 
                     Math.abs(meta.spacing.y) + 
                     Math.abs(meta.spacing.z)) / 3;
  return index * avgSpacing;
}

/**
 * Calculate field of view for a volume along a viewing plane
 */
export function calculateFieldOfView(meta: VolumeMeta, plane: Plane): { width: number; height: number } {
  const { normal, up } = resolvePlane(plane);
  const right = vec3.cross(up, normal);
  
  // Calculate volume corners in world space
  const corners: Vec3[] = [];
  for (let x = 0; x <= 1; x++) {
    for (let y = 0; y <= 1; y++) {
      for (let z = 0; z <= 1; z++) {
        const voxel: Vec3 = {
          x: x * (meta.dims.x - 1),
          y: y * (meta.dims.y - 1),
          z: z * (meta.dims.z - 1)
        };
        
        // Convert to world space
        const world = vec3.add(
          meta.origin,
          {
            x: voxel.x * meta.spacing.x,
            y: voxel.y * meta.spacing.y,
            z: voxel.z * meta.spacing.z
          }
        );
        
        corners.push(world);
      }
    }
  }
  
  // Project corners onto plane axes
  let minRight = Infinity;
  let maxRight = -Infinity;
  let minUp = Infinity;
  let maxUp = -Infinity;
  
  for (const corner of corners) {
    const rightProj = vec3.dot(corner, right);
    const upProj = vec3.dot(corner, up);
    
    minRight = Math.min(minRight, rightProj);
    maxRight = Math.max(maxRight, rightProj);
    minUp = Math.min(minUp, upProj);
    maxUp = Math.max(maxUp, upProj);
  }
  
  return {
    width: maxRight - minRight,
    height: maxUp - minUp
  };
}

/**
 * Create a ViewFrame with explicit scale
 */
export function makeFrameExplicit(
  meta: VolumeMeta,
  plane: Plane,
  slice_mm: number,
  zoom = 1,
  pan: Vec2 = { x: 0, y: 0 },
  viewport: UVec2,
  getNextVersion: () => number
): ViewFrameExplicit {
  const { normal, up } = resolvePlane(plane);
  const right = vec3.normalize(vec3.cross(up, normal));
  
  // Calculate slice center in world space
  const sliceCenter = calculateSliceCenter(meta, normal, slice_mm);
  
  // Calculate field of view
  const fov = calculateFieldOfView(meta, plane);
  
  // Add padding (20% on each side)
  const padding = 1.2;
  const paddedWidth = fov.width * padding;
  const paddedHeight = fov.height * padding;
  
  // Calculate base pixel size (mm per pixel) at zoom=1
  const basePixelSize = Math.max(
    paddedWidth / viewport.x,
    paddedHeight / viewport.y
  );
  
  // Apply zoom to get pixels per mm
  const pixels_per_mm = zoom / basePixelSize;
  
  // Apply pan (convert from pixels to world units)
  const panWorld = vec2.scale(pan, 1 / pixels_per_mm);
  
  // Calculate origin (bottom-left corner in NDC = (0,0))
  const viewWidth = viewport.x / pixels_per_mm;
  const viewHeight = viewport.y / pixels_per_mm;
  
  const origin = vec3.add(
    vec3.add(
      sliceCenter,
      vec3.scale(right, -viewWidth / 2 + panWorld.x)
    ),
    vec3.scale(up, -viewHeight / 2 - panWorld.y) // Negative because Y is flipped
  );
  
  return {
    origin,
    u_dir: right,
    v_dir: up,
    pixels_per_mm,
    viewport_px: viewport,
    version: getNextVersion()
  };
}

/**
 * Calculate the center point of a slice in world space
 */
function calculateSliceCenter(
  meta: VolumeMeta,
  normal: Vec3,
  slice_mm: number
): Vec3 {
  // Volume center in voxel space
  const voxelCenter: Vec3 = {
    x: (meta.dims.x - 1) / 2,
    y: (meta.dims.y - 1) / 2,
    z: (meta.dims.z - 1) / 2
  };
  
  // Convert to world space
  const worldCenter = vec3.add(
    meta.origin,
    {
      x: voxelCenter.x * meta.spacing.x,
      y: voxelCenter.y * meta.spacing.y,
      z: voxelCenter.z * meta.spacing.z
    }
  );
  
  // Project onto the slice plane
  if (Math.abs(normal.x) > 0.9) {
    worldCenter.x = slice_mm;
  } else if (Math.abs(normal.y) > 0.9) {
    worldCenter.y = slice_mm;
  } else if (Math.abs(normal.z) > 0.9) {
    worldCenter.z = slice_mm;
  } else {
    // For oblique planes, project center onto plane at slice distance
    const centerDist = vec3.dot(worldCenter, normal);
    const offset = slice_mm - centerDist;
    return vec3.add(worldCenter, vec3.scale(normal, offset));
  }
  
  return worldCenter;
}

/**
 * Convert ViewFrameExplicit to GPU-ready vectors
 */
export function frameToGpuVectors(frame: ViewFrameExplicit): {
  origin_mm: [number, number, number, number];
  u_mm: [number, number, number, number];
  v_mm: [number, number, number, number];
} {
  // Calculate actual u and v vectors with scale applied
  const u_mm = vec3.scale(frame.u_dir, frame.viewport_px.x / frame.pixels_per_mm);
  const v_mm = vec3.scale(frame.v_dir, frame.viewport_px.y / frame.pixels_per_mm);
  
  return {
    origin_mm: [frame.origin.x, frame.origin.y, frame.origin.z, 1],
    u_mm: [u_mm.x, u_mm.y, u_mm.z, 0],
    v_mm: [v_mm.x, v_mm.y, v_mm.z, 0]
  };
}

/**
 * Transform screen coordinates to world coordinates
 */
export function screenToWorld(frame: ViewFrameExplicit, screen: Vec2): Vec3 {
  // Convert to NDC [0,1]
  const ndc_x = screen.x / frame.viewport_px.x;
  const ndc_y = screen.y / frame.viewport_px.y;
  
  // Calculate world offset from origin
  const world_offset_x = ndc_x * frame.viewport_px.x / frame.pixels_per_mm;
  const world_offset_y = ndc_y * frame.viewport_px.y / frame.pixels_per_mm;
  
  // Calculate world position
  return vec3.add(
    vec3.add(
      frame.origin,
      vec3.scale(frame.u_dir, world_offset_x)
    ),
    vec3.scale(frame.v_dir, world_offset_y)
  );
}

/**
 * Transform world coordinates to screen coordinates
 */
export function worldToScreen(frame: ViewFrameExplicit, world: Vec3): Vec2 | null {
  // Calculate relative position from origin
  const relative = vec3.sub(world, frame.origin);
  
  // Project onto u and v axes
  const u_proj = vec3.dot(relative, frame.u_dir);
  const v_proj = vec3.dot(relative, frame.v_dir);
  
  // Convert to screen pixels
  const screen_x = u_proj * frame.pixels_per_mm;
  const screen_y = v_proj * frame.pixels_per_mm;
  
  // Check if within bounds
  if (screen_x < 0 || screen_x > frame.viewport_px.x ||
      screen_y < 0 || screen_y > frame.viewport_px.y) {
    return null;
  }
  
  return { x: screen_x, y: screen_y };
}

/**
 * Pan the view by pixel offset
 */
export function pan(frame: ViewFrameExplicit, dx_px: number, dy_px: number, getNextVersion: () => number): ViewFrameExplicit {
  // Convert pixel offset to world offset
  const world_dx = dx_px / frame.pixels_per_mm;
  const world_dy = dy_px / frame.pixels_per_mm;
  
  // Update origin
  const newOrigin = vec3.add(
    vec3.add(
      frame.origin,
      vec3.scale(frame.u_dir, world_dx)
    ),
    vec3.scale(frame.v_dir, world_dy)
  );
  
  return {
    ...frame,
    origin: newOrigin,
    version: getNextVersion()
  };
}

/**
 * Zoom around a point
 */
export function zoomAroundPoint(
  frame: ViewFrameExplicit,
  worldPoint: Vec3,
  zoomFactor: number,
  getNextVersion: () => number
): ViewFrameExplicit {
  // Calculate offset from origin to zoom point
  const offset = vec3.sub(worldPoint, frame.origin);
  
  // Update pixels per mm
  const newPixelsPerMm = frame.pixels_per_mm * zoomFactor;
  
  // Adjust origin to keep worldPoint at same screen position
  // The new origin should maintain the focal point
  const newOrigin: Vec3 = {
    x: worldPoint.x - (worldPoint.x - frame.origin.x) / zoomFactor,
    y: worldPoint.y - (worldPoint.y - frame.origin.y) / zoomFactor,
    z: worldPoint.z - (worldPoint.z - frame.origin.z) / zoomFactor
  };
  
  return {
    ...frame,
    origin: newOrigin,
    pixels_per_mm: newPixelsPerMm,
    version: getNextVersion()
  };
}

/**
 * Advance slice by a given number of slices
 */
export function advanceSlice(
  frame: ViewFrameExplicit,
  sliceDelta: number,
  sliceSpacing: number,
  getNextVersion: () => number
): ViewFrameExplicit {
  // Calculate normal from frame vectors
  const normal = vec3.normalize(vec3.cross(frame.u_dir, frame.v_dir));
  
  // Move origin along normal
  const offset = vec3.scale(normal, sliceDelta * sliceSpacing);
  const newOrigin = vec3.add(frame.origin, offset);
  
  return {
    ...frame,
    origin: newOrigin,
    version: getNextVersion()
  };
}

/**
 * Get current slice index
 */
export function getCurrentSliceIndex(
  frame: ViewFrameExplicit,
  meta: VolumeMeta,
  plane: Plane
): number {
  const { normal } = resolvePlane(plane);
  
  // Calculate distance from volume origin to frame origin along normal
  const offset = vec3.sub(frame.origin, meta.origin);
  const distance = vec3.dot(offset, normal);
  
  return sliceMillimetersToIndex(distance, meta, normal);
}

/**
 * Create frame from ViewState camera parameters
 */
export function frameFromViewState(
  worldCenter: Vec3,
  fovMm: number,
  orientation: 'axial' | 'coronal' | 'sagittal',
  viewport: UVec2,
  getNextVersion: () => number
): ViewFrameExplicit {
  // Resolve plane orientation
  const plane: Plane = orientation;
  const { normal, up } = resolvePlane(plane);
  const right = vec3.normalize(vec3.cross(up, normal));
  
  // Calculate pixels per mm from FOV
  const pixels_per_mm = Math.min(viewport.x, viewport.y) / fovMm;
  
  // Calculate view dimensions
  const viewWidth = viewport.x / pixels_per_mm;
  const viewHeight = viewport.y / pixels_per_mm;
  
  // Calculate origin (bottom-left corner)
  const origin = vec3.add(
    vec3.add(
      worldCenter,
      vec3.scale(right, -viewWidth / 2)
    ),
    vec3.scale(up, -viewHeight / 2)
  );
  
  return {
    origin,
    u_dir: right,
    v_dir: up,
    pixels_per_mm,
    viewport_px: viewport,
    version: getNextVersion()
  };
}

/**
 * Calculate the visible bounds of a frame in world space
 */
export function getFrameBounds(frame: ViewFrameExplicit): {
  min: Vec3;
  max: Vec3;
  center: Vec3;
  width: number;
  height: number;
} {
  // Calculate world dimensions
  const width = frame.viewport_px.x / frame.pixels_per_mm;
  const height = frame.viewport_px.y / frame.pixels_per_mm;
  
  // Calculate corners
  const topRight = vec3.add(
    vec3.add(frame.origin, vec3.scale(frame.u_dir, width)),
    vec3.scale(frame.v_dir, height)
  );
  
  // Calculate bounds
  const min: Vec3 = {
    x: Math.min(frame.origin.x, topRight.x),
    y: Math.min(frame.origin.y, topRight.y),
    z: Math.min(frame.origin.z, topRight.z)
  };
  
  const max: Vec3 = {
    x: Math.max(frame.origin.x, topRight.x),
    y: Math.max(frame.origin.y, topRight.y),
    z: Math.max(frame.origin.z, topRight.z)
  };
  
  const center = vec3.scale(vec3.add(min, max), 0.5);
  
  return { min, max, center, width, height };
}

/**
 * Check if two frames are equivalent (same view)
 */
export function framesEqual(a: ViewFrameExplicit, b: ViewFrameExplicit): boolean {
  const epsilon = 0.001;
  
  return Math.abs(a.origin.x - b.origin.x) < epsilon &&
         Math.abs(a.origin.y - b.origin.y) < epsilon &&
         Math.abs(a.origin.z - b.origin.z) < epsilon &&
         Math.abs(a.u_dir.x - b.u_dir.x) < epsilon &&
         Math.abs(a.u_dir.y - b.u_dir.y) < epsilon &&
         Math.abs(a.u_dir.z - b.u_dir.z) < epsilon &&
         Math.abs(a.v_dir.x - b.v_dir.x) < epsilon &&
         Math.abs(a.v_dir.y - b.v_dir.y) < epsilon &&
         Math.abs(a.v_dir.z - b.v_dir.z) < epsilon &&
         Math.abs(a.pixels_per_mm - b.pixels_per_mm) < epsilon &&
         a.viewport_px.x === b.viewport_px.x &&
         a.viewport_px.y === b.viewport_px.y;
}