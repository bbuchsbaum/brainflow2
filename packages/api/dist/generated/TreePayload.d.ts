import type { FlatNode } from "./FlatNode";
/**
 * The payload returned by the fs_list_directory command
 */
export type TreePayload = {
    nodes: Array<FlatNode>;
};
