import type { SidecarEntry } from "./SidecarEntry";
import type { SidecarHeader } from "./SidecarHeader";
/**
 * The answer to `get_sidecar_card`.
 */
export type SidecarCard = {
    path: string;
    fileName: string;
    header: SidecarHeader | null;
    /**
     * Why there is no header: not a NIfTI file, or it could not be read.
     */
    headerIssue: string | null;
    /**
     * The nearest ancestor with a `dataset_description.json`.
     */
    datasetRoot: string | null;
    /**
     * The file name is `key-value` entities and a suffix, so shared sidecars
     * can apply. Otherwise only the same-named `.json` does.
     */
    entityNamed: boolean;
    /**
     * Effective metadata, by key.
     */
    entries: Array<SidecarEntry>;
    /**
     * The sidecars that apply, farthest first.
     */
    sidecarPaths: Array<string>;
    /**
     * Sidecars that apply but could not be read or parsed.
     */
    issues: Array<string>;
    /**
     * More sidecars apply than are read; the farthest were left out.
     */
    truncated: boolean;
};
