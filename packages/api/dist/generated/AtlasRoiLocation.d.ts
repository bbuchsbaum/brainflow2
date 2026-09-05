export type AtlasRoiLocation = {
    id: number;
    name: string;
    hemisphere: string | null;
    network: string | null;
    worldMm: [number, number, number] | null;
    voxelCount: number;
};
