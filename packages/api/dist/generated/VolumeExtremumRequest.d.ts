import type { ExtremumKind } from "./ExtremumKind";
export type VolumeExtremumRequest = {
    volumeId?: string | null;
    layerId?: string | null;
    kind: ExtremumKind;
    timepoint?: number | null;
};
