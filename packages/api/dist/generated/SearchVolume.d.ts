import type { SearchVolumeKind } from "./SearchVolumeKind";
/**
 * The search volume a cluster table was computed on.
 */
export type SearchVolume = {
    kind: SearchVolumeKind;
    maskVolumeId: string | null;
    voxels: number;
};
