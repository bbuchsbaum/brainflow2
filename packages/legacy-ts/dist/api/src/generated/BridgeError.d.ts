export type BridgeError = {
    "Io": {
        code: number;
        details: string;
    };
} | {
    "Loader": {
        code: number;
        details: string;
    };
} | {
    "Scope": {
        code: number;
        path: string;
    };
} | {
    "Input": {
        code: number;
        details: string;
    };
} | {
    "Internal": {
        code: number;
        details: string;
    };
} | {
    "VolumeError": {
        code: number;
        details: string;
    };
} | {
    "GpuError": {
        code: number;
        details: string;
    };
} | {
    "VolumeNotFound": {
        code: number;
        details: string;
    };
} | {
    "ServiceNotInitialized": {
        code: number;
        details: string;
    };
} | {
    "LoaderError": string;
};
