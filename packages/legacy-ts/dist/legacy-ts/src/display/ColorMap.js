// Placeholder implementation of ColorMap from previous codebase
// Will be properly populated during the migration process
export class ColorMap {
    name;
    colors;
    constructor(name, colors) {
        this.name = name;
        this.colors = colors || new Uint8Array(4 * 256); // Default empty RGBA LUT
    }
    // Factory method to create a ColorMap from a preset name
    static fromPreset(name) {
        // This is just a stub - will be implemented later with actual colormaps
        console.warn(`ColorMap.fromPreset('${name}') is not yet fully implemented`);
        const colorMap = new ColorMap(name);
        // Generate some placeholder gradient just to have something
        if (name === 'grayscale') {
            for (let i = 0; i < 256; i++) {
                const idx = i * 4;
                colorMap.colors[idx] = i; // R
                colorMap.colors[idx + 1] = i; // G
                colorMap.colors[idx + 2] = i; // B
                colorMap.colors[idx + 3] = 255; // A
            }
        }
        else {
            // Some rainbow-like gradient as fallback
            for (let i = 0; i < 256; i++) {
                const idx = i * 4;
                colorMap.colors[idx] = Math.min(255, i * 2); // R increases first
                colorMap.colors[idx + 1] = i; // G increases linearly
                colorMap.colors[idx + 2] = Math.max(0, (i - 128) * 2); // B increases later
                colorMap.colors[idx + 3] = 255; // A
            }
        }
        return colorMap;
    }
    // Get the raw color array (RGBA, 8-bit per channel)
    getColorArray() {
        return this.colors;
    }
}
