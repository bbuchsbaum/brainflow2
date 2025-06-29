export type GpuUploadError = {
    "code": "OutOfMemory";
    "detail": {
        needed_mb: number;
        limit_mb: number;
    };
} | {
    "code": "TextureTooLarge";
    "detail": {
        dim: [number, number, number];
        max_dim: number;
    };
} | {
    "code": "UnsupportedFormat";
    "detail": {
        dtype: string;
    };
} | {
    "code": "VolumeNotFound";
    "detail": {
        volume_id: string;
    };
} | {
    "code": "NotDense";
    "detail": {
        volume_id: string;
    };
} | {
    "code": "WgpuError";
    "detail": {
        message: string;
    };
};
