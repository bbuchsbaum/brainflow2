export interface VolumeHandleInfo {
    handle: number;
    dims: [number, number, number];
    dtype: string;
    path: string;
}
export interface RenderFrameParams {
    plane: "axial" | "coronal" | "sagittal";
    frame_no: number;
}
export interface SetFrameParams {
    params: RenderFrameParams;
}
