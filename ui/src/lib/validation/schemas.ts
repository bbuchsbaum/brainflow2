/**
 * Validation schemas using Zod
 * Centralized validation for all data types
 */
import { z } from 'zod';

// File system validation
export const FilePathSchema = z.string()
  .min(1, 'Path cannot be empty')
  .refine(path => !path.includes('..'), 'Path traversal detected')
  .refine(path => path.startsWith('/'), 'Must be absolute path');

export const FileNameSchema = z.string()
  .min(1, 'File name cannot be empty')
  .max(255, 'File name too long')
  .refine(name => !name.includes('/'), 'File name cannot contain slashes');

// Volume and layer validation
export const DimensionsSchema = z.tuple([
  z.number().int().positive(),
  z.number().int().positive(),
  z.number().int().positive()
]);

export const VoxelSizeSchema = z.tuple([
  z.number().positive(),
  z.number().positive(),
  z.number().positive()
]);

export const VolumeSpecSchema = z.object({
  id: z.string().min(1),
  name: FileNameSchema,
  path: FilePathSchema,
  dimensions: DimensionsSchema,
  voxelSize: VoxelSizeSchema,
  dataType: z.enum(['uint8', 'int16', 'float32', 'float64'])
});

export const ColorMapSchema = z.enum([
  'grayscale',
  'hot',
  'cool',
  'viridis',
  'plasma',
  'inferno',
  'magma',
  'cividis'
]);

export const WindowSchema = z.object({
  width: z.number().positive(),
  level: z.number()
});

export const ThresholdSchema = z.object({
  low: z.number(),
  high: z.number()
}).refine(data => data.low <= data.high, 'Low threshold must be <= high threshold');

export const VolumeLayerSpecSchema = z.object({
  id: z.string().min(1),
  source_resource_id: z.string().min(1),
  colormap: ColorMapSchema,
  slice_axis: z.number().int().min(0).max(2).nullable(),
  slice_index: z.number().int().min(0).nullable()
});

export const LayerSpecSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('Volume'),
    Volume: VolumeLayerSpecSchema
  })
]);

// Coordinate validation
export const WorldCoordSchema = z.tuple([
  z.number(),
  z.number(),
  z.number()
]);

export const VoxelCoordSchema = z.tuple([
  z.number().int().min(0),
  z.number().int().min(0),
  z.number().int().min(0)
]);

// GPU resource validation
export const ViewportSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive()
});

export const RenderRequestSchema = z.object({
  layerId: z.string().min(1),
  viewport: ViewportSchema,
  showCrosshair: z.boolean().optional(),
  crosshairWorld: WorldCoordSchema.optional()
});

// Tree/file browser validation
export const TreeNodeSchema = z.object({
  id: FilePathSchema,
  name: FileNameSchema,
  is_dir: z.boolean(),
  size: z.number().int().min(0).optional(),
  parent_idx: z.number().int().nullable()
});

// Mount validation
export const MountPathSchema = z.string()
  .min(1, 'Mount path cannot be empty')
  .refine(path => path.startsWith('/'), 'Must be absolute path');

export const FilePatternSchema = z.string()
  .refine(pattern => pattern.startsWith('.'), 'Pattern must start with dot');

export const MountConfigSchema = z.object({
  id: z.string().min(1),
  path: MountPathSchema,
  label: z.string().min(1).max(50),
  filePatterns: z.array(FilePatternSchema)
});

// Additional validation for new services
export const WorldCoordinateSchema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite()
]);

// Export type aliases for convenience
export type FilePath = z.infer<typeof FilePathSchema>;
export type FileName = z.infer<typeof FileNameSchema>;
export type Dimensions = z.infer<typeof DimensionsSchema>;
export type VoxelSize = z.infer<typeof VoxelSizeSchema>;
export type VolumeSpec = z.infer<typeof VolumeSpecSchema>;
export type LayerSpec = z.infer<typeof LayerSpecSchema>;
export type WorldCoord = z.infer<typeof WorldCoordSchema>;
export type VoxelCoord = z.infer<typeof VoxelCoordSchema>;
export type Viewport = z.infer<typeof ViewportSchema>;
export type RenderRequest = z.infer<typeof RenderRequestSchema>;
export type TreeNode = z.infer<typeof TreeNodeSchema>;
export type MountConfig = z.infer<typeof MountConfigSchema>;