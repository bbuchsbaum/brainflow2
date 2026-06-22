import type { StudioCompareBindingKind } from "./StudioCompareBindingKind";
import type { StudioCompareCacheStatus } from "./StudioCompareCacheStatus";
export type StudioComparePaneBinding = {
    kind: StudioCompareBindingKind;
    ready: boolean;
    sourcePath: string | null;
    materializationKey: string | null;
    materializedAtMs: bigint | null;
    cacheStatus: StudioCompareCacheStatus;
    cacheMessage: string | null;
    provenancePath: string | null;
};
