/**
 * @brainflow/api v0.1.1 - Core TypeScript Interfaces
 */
export * from './generated';
export * from './helpers';
import type { VolumeHandleInfo, VolumeLayerGpuInfo, BridgeError, TimeSeriesResult, LayerSpec, ReleaseResult } from './generated';
/**
 * Generic Result type for Tauri commands, mirroring Rust's Result.
 */
export type Result<T, E = string> = {
    Ok: T;
    Err?: never;
} | {
    Ok?: never;
    Err: E;
};
export interface CoreApi {
    load_file(path: string): Promise<VolumeHandleInfo>;
    world_to_voxel(volumeId: string, worldCoord: [number, number, number]): Promise<[number, number, number] | null>;
    get_timeseries_matrix(volumeId: string, coords: Array<[number, number, number]>): Promise<TimeSeriesResult>;
    request_layer_gpu_resources(layerSpec: LayerSpec): Promise<Result<VolumeLayerGpuInfo, BridgeError>>;
    release_layer_gpu_resources(layerId: string): Promise<ReleaseResult>;
    supports_webgpu(): Promise<boolean>;
    set_crosshair(world_coords: [number, number, number]): Promise<void>;
    set_view_plane(plane_id: 0 | 1 | 2): Promise<void>;
    init_render_loop(canvas_id: string): Promise<void>;
    resize_canvas(width: number, height: number): Promise<void>;
    update_frame_ubo(view_proj: number[], // 16 elements for 4x4 matrix
    world_to_voxel: number[], // 16 elements for 4x4 matrix
    crosshair_voxel: number[], // 4 elements
    view_plane_normal: number[], // 4 elements
    view_plane_distance: number): Promise<void>;
    render_frame(): Promise<void>;
}
export type VolumeHandle = VolumeHandleInfo & {
    type: 'volume';
};
export type SurfaceHandle = {
    type: 'surface';
    id: string;
    name: string;
};
export type AtlasLayerHandle = {
    type: 'atlas';
    id: string;
    name: string;
};
export type NumericType = 'float32' | 'int32' | 'uint32' | 'int16' | 'uint16' | 'int8' | 'uint8';
export type DataBuffer = ArrayBuffer | SharedArrayBuffer;
export interface DataFrame {
    shape: [number, number];
    columns: string[];
    buffer: DataBuffer;
    colDtype: NumericType[];
}
export interface DataSample {
    type: "timeseries" | "dataframe" | string;
    data: DataFrame | Float32Array | any;
    metadata?: Record<string, unknown>;
}
export interface LoaderPlugin {
    manifest: PluginManifest;
    load(filePath: string, coreApi: CoreApi): Promise<VolumeHandle | SurfaceHandle | AtlasLayerHandle>;
}
export interface PlotPlugin {
    manifest: PluginManifest;
    render(targetElement: HTMLElement | OffscreenCanvas, data: DataSample, options?: Record<string, unknown>): Promise<void>;
    resize?(width: number, height: number): Promise<void>;
    dispose?(): Promise<void>;
}
export interface PluginManifest {
    id: string;
    name: string;
    version: string;
    compatibleCore: string;
    type: 'loader' | 'plot' | string;
    apiVersion: string;
    entrypoint: string;
    description?: string;
    author?: string;
    handles?: string[] | Record<string, unknown>;
}
