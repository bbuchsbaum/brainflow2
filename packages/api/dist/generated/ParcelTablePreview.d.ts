import type { ParcelColumnInfo } from "./ParcelColumnInfo";
export type ParcelTablePreview = {
    atlasName: string;
    atlasParcels: number;
    headers: Array<string>;
    columns: Array<ParcelColumnInfo>;
    rowCount: number;
    matchedParcels: number;
    missingParcels: number;
    bindingError: string | null;
    keyExamples: Array<string>;
    dictionarySha256: string;
    tableSha256: string;
};
