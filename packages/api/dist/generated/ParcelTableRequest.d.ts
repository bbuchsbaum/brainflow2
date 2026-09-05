export type ParcelTableRequest = {
    sourceVolumeId: string;
    text: string;
    delimiter: string;
    keyColumn: string | null;
    keyKind: string;
    hemisphereColumn: string | null;
    networkColumn: string | null;
    allowPartial: boolean;
};
