export type Loaded = {
    "type": "Volume";
    "data": {
        dims: [number, number, number];
        dtype: string;
        path: string;
    };
} | {
    "type": "Table";
    "data": {
        rows: number;
        cols: number;
        path: string;
    };
} | {
    "type": "Image2D";
    "data": {
        width: number;
        height: number;
        path: string;
    };
} | {
    "type": "Metadata";
    "data": {
        path: string;
        loader_type: string;
    };
};
