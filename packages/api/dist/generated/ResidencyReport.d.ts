import type { ResidencyLayerReport } from "./ResidencyLayerReport";
/**
 * The backend's view of residency, sent as `residency-changed` and returned
 * by `get_residency_state`. Every report takes the next `seq`.
 */
export type ResidencyReport = {
    seq: number;
    /**
     * `None` in the fixed-slot fallback.
     */
    budget_bytes: number | null;
    used_bytes: number;
    /**
     * Distinct textures one draw binds.
     */
    binding_capacity: number;
    /**
     * Resident bytes no frame demands; pressure evicts these first.
     */
    undemanded_bytes: number;
    /**
     * By layer id.
     */
    layers: Array<ResidencyLayerReport>;
};
