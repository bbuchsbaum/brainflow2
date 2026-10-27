import type { LabelSource } from "./LabelSource";
/**
 * A region locus: the voxels of `labelSource` whose label is in `labelIds`.
 */
export type RegionLocus = {
    labelSource: LabelSource;
    labelIds: Array<number>;
};
