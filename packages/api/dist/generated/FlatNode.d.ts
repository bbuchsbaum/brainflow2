/**
 * Represents a node in the file tree, optimized for flat list transfer
 */
export type FlatNode = {
    id: string;
    name: string;
    parent_idx: number | null;
    icon_id: number;
    is_dir: boolean;
};
