/**
 * Annotation Import/Export utilities
 * 
 * Provides functions to save and load annotations in various formats
 * including JSON, CSV, and neuroimaging-specific formats
 */

import type { Annotation } from '$lib/types/annotations';

/**
 * Export annotations to JSON format
 */
export function exportToJSON(annotations: Annotation[]): string {
  const data = {
    version: '1.0',
    created: new Date().toISOString(),
    annotations: annotations.map(a => ({
      ...a,
      // Ensure all properties are serializable
      worldCoord: { ...a.worldCoord },
      ...(a.type === 'line' && 'endCoord' in a ? { endCoord: { ...a.endCoord } } : {}),
      ...(a.type === 'measurement' && 'points' in a ? { points: a.points.map(p => ({ ...p })) } : {})
    }))
  };
  
  return JSON.stringify(data, null, 2);
}

/**
 * Import annotations from JSON format
 */
export function importFromJSON(jsonString: string): Annotation[] {
  try {
    const data = JSON.parse(jsonString);
    
    // Validate version
    if (!data.version || !data.annotations) {
      throw new Error('Invalid annotation file format');
    }
    
    // Process annotations
    return data.annotations.map((a: any) => ({
      ...a,
      // Ensure dates are numbers
      createdAt: typeof a.createdAt === 'string' ? new Date(a.createdAt).getTime() : a.createdAt,
      modifiedAt: typeof a.modifiedAt === 'string' ? new Date(a.modifiedAt).getTime() : a.modifiedAt,
    }));
  } catch (error) {
    throw new Error(`Failed to parse annotation file: ${error.message}`);
  }
}

/**
 * Export annotations to CSV format
 */
export function exportToCSV(annotations: Annotation[]): string {
  const headers = [
    'id',
    'type',
    'world_x',
    'world_y',
    'world_z',
    'label',
    'color',
    'visible',
    'created_at',
    'additional_data'
  ];
  
  const rows = annotations.map(a => {
    const label = 
      a.type === 'text' ? a.text :
      a.type === 'roi' && a.label ? a.label :
      a.type === 'line' && a.label ? a.label :
      '';
    
    const additionalData: Record<string, any> = {};
    
    // Add type-specific data
    switch (a.type) {
      case 'marker':
        additionalData.style = a.style;
        additionalData.size = a.size;
        break;
      case 'line':
        additionalData.endX = a.endCoord.x;
        additionalData.endY = a.endCoord.y;
        additionalData.endZ = a.endCoord.z;
        break;
      case 'roi':
        additionalData.shape = a.shape;
        additionalData.dimensions = JSON.stringify(a.dimensions);
        break;
      case 'measurement':
        additionalData.measurementType = a.measurementType;
        additionalData.points = JSON.stringify(a.points);
        break;
    }
    
    return [
      a.id,
      a.type,
      a.worldCoord.x.toFixed(3),
      a.worldCoord.y.toFixed(3),
      a.worldCoord.z.toFixed(3),
      `"${label.replace(/"/g, '""')}"`, // Escape quotes
      a.color || '',
      a.visible ? 'true' : 'false',
      new Date(a.createdAt).toISOString(),
      JSON.stringify(additionalData)
    ];
  });
  
  return [
    headers.join(','),
    ...rows.map(row => row.join(','))
  ].join('\n');
}

/**
 * Export annotations to ITK-SNAP format
 * This is a simplified version - full ITK-SNAP format would require more metadata
 */
export function exportToITKSnap(annotations: Annotation[]): string {
  const points = annotations
    .filter(a => a.type === 'marker' || a.type === 'text')
    .map((a, index) => {
      const label = a.type === 'text' ? a.text : `Point ${index + 1}`;
      // ITK-SNAP format: x y z label
      return `${a.worldCoord.x.toFixed(3)} ${a.worldCoord.y.toFixed(3)} ${a.worldCoord.z.toFixed(3)} # ${label}`;
    });
  
  return points.join('\n');
}

/**
 * Export annotations to FSL format (simple point list)
 */
export function exportToFSL(annotations: Annotation[]): string {
  const points = annotations
    .filter(a => a.type === 'marker' || a.type === 'text')
    .map(a => {
      // FSL format typically uses voxel coordinates, but we'll use world coordinates
      return `${a.worldCoord.x.toFixed(3)} ${a.worldCoord.y.toFixed(3)} ${a.worldCoord.z.toFixed(3)}`;
    });
  
  return points.join('\n');
}

/**
 * Generate a downloadable file from annotation data
 */
export function downloadAnnotations(
  annotations: Annotation[],
  format: 'json' | 'csv' | 'itksnap' | 'fsl',
  filename: string
): void {
  let content: string;
  let mimeType: string;
  let extension: string;
  
  switch (format) {
    case 'json':
      content = exportToJSON(annotations);
      mimeType = 'application/json';
      extension = '.json';
      break;
    case 'csv':
      content = exportToCSV(annotations);
      mimeType = 'text/csv';
      extension = '.csv';
      break;
    case 'itksnap':
      content = exportToITKSnap(annotations);
      mimeType = 'text/plain';
      extension = '.txt';
      break;
    case 'fsl':
      content = exportToFSL(annotations);
      mimeType = 'text/plain';
      extension = '.txt';
      break;
  }
  
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename + extension;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Load annotations from a file
 */
export async function loadAnnotationsFromFile(file: File): Promise<Annotation[]> {
  const text = await file.text();
  
  // Try to detect format
  if (file.name.endsWith('.json')) {
    return importFromJSON(text);
  } else {
    throw new Error('Unsupported file format. Only JSON files are currently supported for import.');
  }
}

/**
 * Convert annotations to a format suitable for overlaying on NIfTI volumes
 * This returns a binary mask where annotation locations are marked
 */
export function annotationsToVolumeMask(
  annotations: Annotation[],
  volumeDims: { x: number; y: number; z: number },
  volumeOrigin: { x: number; y: number; z: number },
  volumeSpacing: { x: number; y: number; z: number }
): Uint8Array {
  const voxelCount = volumeDims.x * volumeDims.y * volumeDims.z;
  const mask = new Uint8Array(voxelCount);
  
  // Helper to convert world to voxel coordinates
  const worldToVoxel = (world: { x: number; y: number; z: number }) => {
    return {
      x: Math.round((world.x - volumeOrigin.x) / volumeSpacing.x),
      y: Math.round((world.y - volumeOrigin.y) / volumeSpacing.y),
      z: Math.round((world.z - volumeOrigin.z) / volumeSpacing.z)
    };
  };
  
  // Helper to check if voxel is in bounds
  const isInBounds = (voxel: { x: number; y: number; z: number }) => {
    return voxel.x >= 0 && voxel.x < volumeDims.x &&
           voxel.y >= 0 && voxel.y < volumeDims.y &&
           voxel.z >= 0 && voxel.z < volumeDims.z;
  };
  
  // Mark annotation locations
  annotations.forEach((annotation, index) => {
    const labelValue = (index % 255) + 1; // Avoid 0 (background)
    
    if (annotation.type === 'marker' || annotation.type === 'text') {
      const voxel = worldToVoxel(annotation.worldCoord);
      if (isInBounds(voxel)) {
        const idx = voxel.x + voxel.y * volumeDims.x + voxel.z * volumeDims.x * volumeDims.y;
        mask[idx] = labelValue;
      }
    } else if (annotation.type === 'roi' && annotation.shape === 'circle') {
      // For circular ROIs, mark all voxels within the circle
      const center = worldToVoxel(annotation.worldCoord);
      const radiusVoxels = annotation.dimensions.radius / Math.min(volumeSpacing.x, volumeSpacing.y, volumeSpacing.z);
      
      for (let dx = -Math.ceil(radiusVoxels); dx <= Math.ceil(radiusVoxels); dx++) {
        for (let dy = -Math.ceil(radiusVoxels); dy <= Math.ceil(radiusVoxels); dy++) {
          for (let dz = -Math.ceil(radiusVoxels); dz <= Math.ceil(radiusVoxels); dz++) {
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (distance <= radiusVoxels) {
              const voxel = {
                x: center.x + dx,
                y: center.y + dy,
                z: center.z + dz
              };
              if (isInBounds(voxel)) {
                const idx = voxel.x + voxel.y * volumeDims.x + voxel.z * volumeDims.x * volumeDims.y;
                mask[idx] = labelValue;
              }
            }
          }
        }
      }
    }
  });
  
  return mask;
}