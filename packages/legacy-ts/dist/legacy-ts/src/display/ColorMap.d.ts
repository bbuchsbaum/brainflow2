export declare class ColorMap {
    private name;
    private colors;
    constructor(name: string, colors?: Uint8Array);
    static fromPreset(name: string): ColorMap;
    getColorArray(): Uint8Array;
}
