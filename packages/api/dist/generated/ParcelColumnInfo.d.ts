export type ParcelColumnInfo = {
    name: string;
    range: [number, number] | null;
    finiteCount: number;
    missingCount: number;
    error: string | null;
};
