export declare const BRIDGE_MODULES: {
    readonly analysis: {
        readonly id: "analysis";
        readonly title: "Analysis";
        readonly version: "0.1.0";
        readonly stage: "experimental";
        readonly commands: readonly ["list_analyses", "start_analysis", "cancel_analysis", "get_analysis_job_status"];
    };
    readonly segmentation: {
        readonly id: "segmentation";
        readonly title: "Segmentation";
        readonly version: "0.1.0";
        readonly stage: "experimental";
        readonly commands: readonly ["segmentation_create_session", "segmentation_get_session", "segmentation_preview_stroke", "segmentation_commit_stroke", "segmentation_undo", "segmentation_set_label_state", "segmentation_get_slice"];
    };
};
export type BridgeModuleId = keyof typeof BRIDGE_MODULES;
export type BridgeModuleCommand<M extends BridgeModuleId = BridgeModuleId> = (typeof BRIDGE_MODULES)[M]['commands'][number];
