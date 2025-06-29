/**
 * ViewFrame creation and manipulation
 */
import type { Vec3, Vec2, UVec2, ViewFrame, VolumeMeta, Plane } from './types';
import { vec3, vec2 } from './vecmath';

/**
 * Standard anatomical planes
 */
const ANATOMICAL_PLANES = {
  axial: {
    normal: [0, 0, 1] as Vec3,    // Z axis (inferior-superior)
    up: [0, 1, 0] as Vec3         // Y axis (posterior-anterior)
  },
  coronal: {
    normal: [0, 1, 0] as Vec3,    // Y axis (posterior-anterior)
    up: [0, 0, -1] as Vec3        // -Z axis (superior-inferior, flipped for display)
  },
  sagittal: {
    normal: [1, 0, 0] as Vec3,    // X axis (left-right)
    up: [0, 0, -1] as Vec3        // -Z axis (superior-inferior, flipped for display)
  }
};

/**
 * Resolve plane specification to normal and up vectors
 */
export function resolvePlane(plane: Plane): { normal: Vec3; up: Vec3 } {
  if (typeof plane === 'string') {
    const anatomical = ANATOMICAL_PLANES[plane];
    if (!anatomical) {
      throw new Error(`Unknown anatomical plane: ${plane}`);
    }
    return anatomical;
  }
  
  // Custom plane - ensure orthonormal
  const normal = vec3.normalize(plane.normal);
  const up = vec3.normalize(plane.up);
  
  // Ensure up is perpendicular to normal
  const upProjection = vec3.scale(normal, vec3.dot(up, normal));
  const upOrthogonal = vec3.normalize(vec3.sub(up, upProjection));
  
  return { normal, up: upOrthogonal };
}

/**
 * Convert slice position from mm to voxel index along a normal
 */
export function sliceMillimetersToIndex(
  slice_mm: number,
  meta: VolumeMeta,
  normal: Vec3
): number {
  // For standard axes, this is straightforward
  // For oblique planes, would need more complex calculation
  
  // Simplified for axis-aligned normals
  if (Math.abs(normal[0]) > 0.9) {
    // X axis
    return (slice_mm - meta.origin[0]) / meta.spacing[0];
  } else if (Math.abs(normal[1]) > 0.9) {
    // Y axis
    return (slice_mm - meta.origin[1]) / meta.spacing[1];
  } else if (Math.abs(normal[2]) > 0.9) {
    // Z axis
    return (slice_mm - meta.origin[2]) / meta.spacing[2];
  }
  
  // For oblique planes, project onto normal
  // This is a simplified calculation
  const avgSpacing = (Math.abs(meta.spacing[0]) + 
                      Math.abs(meta.spacing[1]) + 
                      Math.abs(meta.spacing[2])) / 3;
  return slice_mm / avgSpacing;
}

/**
 * Convert slice index to mm position along a normal
 */
export function sliceIndexToMillimeters(
  index: number,
  meta: VolumeMeta,
  normal: Vec3
): number {
  // Simplified for axis-aligned normals
  if (Math.abs(normal[0]) > 0.9) {
    return meta.origin[0] + index * meta.spacing[0];
  } else if (Math.abs(normal[1]) > 0.9) {
    return meta.origin[1] + index * meta.spacing[1];
  } else if (Math.abs(normal[2]) > 0.9) {
    return meta.origin[2] + index * meta.spacing[2];
  }
  
  // For oblique planes
  const avgSpacing = (Math.abs(meta.spacing[0]) + 
                      Math.abs(meta.spacing[1]) + 
                      Math.abs(meta.spacing[2])) / 3;
  return index * avgSpacing;
}

/**
 * Calculate the field of view for a volume along a viewing plane
 */
export function calculateFieldOfView(
  meta: VolumeMeta,
  plane: Plane
): { width: number; height: number } {
  const { normal, up } = resolvePlane(plane);
  const right = vec3.cross(up, normal);
  
  // Calculate volume corners in world space
  const corners: Vec3[] = [];
  for (let x = 0; x <= 1; x++) {
    for (let y = 0; y <= 1; y++) {
      for (let z = 0; z <= 1; z++) {
        const voxel: Vec3 = [
          x * (meta.dims[0] - 1),
          y * (meta.dims[1] - 1),
          z * (meta.dims[2] - 1)
        ];
        
        // Convert to world space
        const world: Vec3 = [
          meta.origin[0] + voxel[0] * meta.spacing[0],
          meta.origin[1] + voxel[1] * meta.spacing[1],
          meta.origin[2] + voxel[2] * meta.spacing[2]
        ];
        
        // Apply direction matrix if present
        if (meta.direction) {
          const rotated = vec3.transformMat3(
            vec3.scale(voxel, 1), // Scale by spacing is already done
            meta.direction
          );
          world[0] = meta.origin[0] + rotated[0] * meta.spacing[0];
          world[1] = meta.origin[1] + rotated[1] * meta.spacing[1];
          world[2] = meta.origin[2] + rotated[2] * meta.spacing[2];
        }
        
        corners.push(world);
      }
    }
  }
  
  // Project corners onto plane axes
  let minRight = Infinity, maxRight = -Infinity;
  let minUp = Infinity, maxUp = -Infinity;
  
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
 * Create a ViewFrame for rendering a slice
 * 
 * @param meta - Volume metadata
 * @param plane - Viewing plane specification
 * @param slice - Slice position in mm
 * @param zoom - Zoom factor (>1 = zoom in)
 * @param pan - Pan offset in screen pixels
 * @param viewport - Viewport dimensions in pixels
 * @returns ViewFrame for GPU rendering
 */
export function makeFrame(
  meta: VolumeMeta,
  plane: Plane,
  slice: number,
  zoom = 1,
  pan: Vec2 = { x: 0, y: 0 },
  viewport: UVec2
): ViewFrame {
  const { normal, up } = resolvePlane(plane);
  const right = vec3.cross(up, normal);
  
  // Calculate slice center in world space
  const sliceCenter = calculateSliceCenter(meta, normal, slice);
  
  // Calculate field of view
  const fov = calculateFieldOfView(meta, plane);
  
  // Add padding (20% on each side)
  const padding = 1.2;
  const paddedWidth = fov.width * padding;
  const paddedHeight = fov.height * padding;
  
  // Apply zoom
  const viewWidth = paddedWidth / zoom;
  const viewHeight = paddedHeight / zoom;
  
  // Calculate pixel size to maintain aspect ratio
  // We want to fit the view into the viewport while keeping pixels square
  const pixelSize = Math.max(
    viewWidth / viewport.width,
    viewHeight / viewport.height
  );
  
  // Calculate actual dimensions that will be rendered
  const renderWidth = viewport.width * pixelSize;
  const renderHeight = viewport.height * pixelSize;
  
  // Apply pan (convert from pixels to world units)
  const panWorld = vec2.scale(pan, pixelSize);
  
  // Calculate origin (bottom-left corner in NDC = (0,0))
  // Start from slice center, then offset to bottom-left
  const origin = vec3.add(
    vec3.add(
      sliceCenter,
      vec3.scale(right, -renderWidth / 2 + panWorld.x)
    ),
    vec3.scale(up, -renderHeight / 2 - panWorld.y) // Negative because Y is flipped
  );
  
  // U and V vectors span the full viewport
  const u = vec3.scale(right, renderWidth);
  const v = vec3.scale(up, renderHeight);
  
  return {
    origin,
    u,
    v,
    viewport_px: viewport
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
  const voxelCenter: Vec3 = [
    (meta.dims[0] - 1) / 2,
    (meta.dims[1] - 1) / 2,
    (meta.dims[2] - 1) / 2
  ];
  
  // Convert to world space
  let worldCenter: Vec3 = [
    meta.origin[0] + voxelCenter[0] * meta.spacing[0],
    meta.origin[1] + voxelCenter[1] * meta.spacing[1],
    meta.origin[2] + voxelCenter[2] * meta.spacing[2]
  ];
  
  // Apply direction matrix if present
  if (meta.direction) {
    const rotated = vec3.transformMat3(voxelCenter, meta.direction);
    worldCenter = vec3.add(meta.origin, [
      rotated[0] * meta.spacing[0],
      rotated[1] * meta.spacing[1],
      rotated[2] * meta.spacing[2]
    ]);
  }
  
  // Project onto the slice plane
  // For axis-aligned planes, we just replace the appropriate coordinate
  if (Math.abs(normal[0]) > 0.9) {
    worldCenter[0] = slice_mm;
  } else if (Math.abs(normal[1]) > 0.9) {
    worldCenter[1] = slice_mm;
  } else if (Math.abs(normal[2]) > 0.9) {
    worldCenter[2] = slice_mm;
  } else {
    // For oblique planes, project center onto plane at slice distance
    const centerDist = vec3.dot(worldCenter, normal);
    const offset = slice_mm - centerDist;
    worldCenter = vec3.add(worldCenter, vec3.scale(normal, offset));
  }
  
  return worldCenter;
}

/**
 * Convert screen coordinates to world coordinates
 * 
 * @param frame - Current view frame
 * @param screenPx - Screen position in pixels from top-left
 * @returns World position in mm
 */
export function screenToWorld(frame: ViewFrame, screenPx: Vec2): Vec3 {
  // Convert to NDC [0,1]
  const ndcX = screenPx.x / frame.viewport_px.width;
  const ndcY = screenPx.y / frame.viewport_px.height;
  
  // Calculate world position
  // origin + ndcX * u + ndcY * v
  const worldPos = vec3.add(
    vec3.add(
      frame.origin,
      vec3.scale(frame.u, ndcX)
    ),
    vec3.scale(frame.v, ndcY)
  );
  
  return worldPos;
}

/**
 * Convert world coordinates to screen coordinates
 * 
 * @param frame - Current view frame
 * @param worldPos - World position in mm
 * @returns Screen position in pixels from top-left, or null if not on plane
 */
export function worldToScreen(frame: ViewFrame, worldPos: Vec3): Vec2 | null {
  // Calculate relative position from origin
  const relative = vec3.sub(worldPos, frame.origin);
  
  // Project onto u and v axes
  const uLength = vec3.length(frame.u);
  const vLength = vec3.length(frame.v);
  
  if (uLength === 0 || vLength === 0) {
    return null;
  }
  
  const uNorm = vec3.scale(frame.u, 1 / uLength);
  const vNorm = vec3.scale(frame.v, 1 / vLength);
  
  const uProj = vec3.dot(relative, uNorm);
  const vProj = vec3.dot(relative, vNorm);
  
  // Convert to NDC
  const ndcX = uProj / uLength;
  const ndcY = vProj / vLength;
  
  // Check if within frame bounds
  if (ndcX < 0 || ndcX > 1 || ndcY < 0 || ndcY > 1) {
    return null;
  }
  
  // Convert to screen pixels
  return {
    x: ndcX * frame.viewport_px.width,
    y: ndcY * frame.viewport_px.height
  };
}

/**
 * Check if a world point is visible in the current frame
 */
export function isPointVisible(frame: ViewFrame, worldPos: Vec3): boolean {
  const screenPos = worldToScreen(frame, worldPos);
  return screenPos !== null;
}

/**
 * Get the slice distance (position along normal) for a world point
 */
export function getSliceDistance(
  frame: ViewFrame,
  worldPos: Vec3,
  plane: Plane
): number {
  const { normal } = resolvePlane(plane);
  
  // Calculate plane normal from frame (u × v)
  const frameNormal = vec3.normalize(vec3.cross(frame.u, frame.v));
  
  // Get a point on the plane (frame origin)
  const planePoint = frame.origin;
  
  // Calculate distance from worldPos to plane
  const toPoint = vec3.sub(worldPos, planePoint);
  const distance = vec3.dot(toPoint, frameNormal);
  
  return distance;
}