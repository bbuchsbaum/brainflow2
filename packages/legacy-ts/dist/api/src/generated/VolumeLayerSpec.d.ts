import type { SliceAxis } from "./SliceAxis";
import type { SliceIndex } from "./SliceIndex";
export type VolumeLayerSpec = {
    id: string;
    source_resource_id: string;
    colormap: string;
    slice_axis: SliceAxis | null;
    slice_index: SliceIndex | null;
};
