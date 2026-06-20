/**
 * Represents a node in the file tree, optimized for flat list transfer
 */
export type FlatNode = {
    id: string;
    name: string;
    parentIdx: number | null;
    iconId: number;
    isDir: boolean;
};
