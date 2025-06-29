export interface BridgeError {
    type: "Io" | "Loader" | "Scope" | "Input" | "Internal" | "VolumeError" | "GpuError" | "VolumeNotFound" | "ServiceNotInitialized";
    code: number;
    details?: string;
    path?: string;
}
export type Loaded = {
    type: "Volume";
    data: {
        dims: [number, number, number];
        dtype: string;
        path: string;
    };
} | {
    type: "Table";
    data: {
        rows: number;
        cols: number;
        path: string;
    };
} | {
    type: "Image2D";
    data: {
        width: number;
        height: number;
        path: string;
    };
} | {
    type: "Metadata";
    data: {
        path: string;
        loader_type: string;
    };
};
export interface GpuUploadError {
    code: "OutOfMemory" | "TextureTooLarge" | "UnsupportedFormat" | "VolumeNotFound" | "NotDense" | "WgpuError";
    detail: {
        needed_mb?: number;
        limit_mb?: number;
        dim?: [number, number, number];
        max_dim?: number;
        dtype?: string;
        volume_id?: string;
        message?: string;
    };
}
export type GpuTextureFormat = "R8Unorm" | "R16Float" | "R32Float" | "RGBA8Unorm";
export interface VolumeLayerGpuInfo {
    layer_id: string;
    world_to_voxel: number[];
    dim: [number, number, number];
    pad_slices: number;
    tex_format: GpuTextureFormat;
}
export interface FlatNode {
    id: string;
    name: string;
    parent_idx: number | null;
    icon_id: number;
    is_dir: boolean;
}
export interface TreePayload {
    nodes: FlatNode[];
}
export declare const ICON_IDS: {
    readonly FOLDER: 0;
    readonly FILE: 1;
    readonly NIFTI: 2;
    readonly GIFTI: 3;
    readonly TABLE: 4;
    readonly IMAGE: 5;
};
