import type { DataRange } from "./DataRange";
import type { GpuTextureFormat } from "./GpuTextureFormat";
import type { SliceInfo } from "./SliceInfo";
import type { TextureCoordinates } from "./TextureCoordinates";
/**
 * Information about GPU resources allocated for a volume layer (matches VolumeLayerGPU in ADR-002)
 */
export type VolumeLayerGpuInfo = {
    /**
     * Opaque handle/ID for the layer (used by UI)
     */
    layer_id: string;
    /**
     * Matrix: LPI World (x,y,z,1) -> Atlas Texture (u,v,slice_idx,w)
     * Stored as a flat array (row-major)
     */
    world_to_voxel: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
    /**
     * Native voxel dimensions [nx, ny, nz]
     */
    dim: [number, number, number];
    /**
     * Number of slices packed along the atlas page dimension (often 1 for 2D array texture)
     */
    pad_slices: number;
    /**
     * Actual GPU texture format used
     */
    tex_format: GpuTextureFormat;
    /**
     * GPU atlas layer index (which layer in the texture array)
     */
    atlas_layer_index: number;
    /**
     * Slice information
     */
    slice_info: SliceInfo;
    /**
     * Texture coordinates within the atlas layer
     */
    texture_coords: TextureCoordinates;
    /**
     * Voxel to world transformation matrix (row-major)
     */
    voxel_to_world: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
    /**
     * Volume origin in world coordinates
     */
    origin: [number, number, number];
    /**
     * World-space centre of the volume (handy for initial cross-hair)
     */
    center_world: [number, number, number];
    /**
     * Voxel spacing in mm
     */
    spacing: [number, number, number];
    /**
     * Data range (min, max values in the slice)
     */
    data_range: DataRange | null;
    /**
     * Source volume ID that this layer was created from
     */
    source_volume_id: string;
    /**
     * Timestamp when this GPU resource was allocated
     */
    allocated_at: bigint;
    /**
     * Indicates if the volume looks like a binary mask (values 0/1)
     */
    is_binary_like: boolean;
};
