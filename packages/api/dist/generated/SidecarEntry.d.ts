import type { SidecarLevel } from "./SidecarLevel";
export type SidecarEntry = {
    key: string;
    /**
     * The effective value as compact JSON, cut at a bounded length.
     */
    value: string;
    valueTruncated: boolean;
    sourceLevel: SidecarLevel;
    sourcePath: string;
    /**
     * Farther sidecars that also set this key and were overridden.
     */
    overriddenPaths: Array<string>;
};
