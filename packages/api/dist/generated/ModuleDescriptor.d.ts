import type { ModuleStage } from "./ModuleStage";
/**
 * Static identity of a bridge module.
 */
export type ModuleDescriptor = {
    /**
     * Module id; matches the `module <id>` section in `command_list.rs`.
     */
    id: string;
    title: string;
    version: string;
    stage: ModuleStage;
};
