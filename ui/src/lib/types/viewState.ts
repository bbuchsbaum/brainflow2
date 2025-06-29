/**
 * ViewState API - declarative rendering state management
 * Mirrors the Rust ViewState implementation
 */

/**
 * Anatomical viewing planes
 */
export enum SliceOrientation {
    Axial = 'axial',      // Looking down Z axis
    Coronal = 'coronal',  // Looking down Y axis  
    Sagittal = 'sagittal' // Looking down X axis
}

/**
 * Camera configuration in world space
 */
export interface CameraState {
    /** Point we're looking at in world coordinates */
    worldCenter: [number, number, number];
    
    /** Field of view in mm */
    fovMm: number;
    
    /** Which anatomical plane we're viewing */
    orientation: SliceOrientation;
}

/**
 * How to blend layers
 */
export enum BlendMode {
    Normal = 'normal',
    Add = 'add', 
    Max = 'max',
    Min = 'min'
}

/**
 * Threshold modes
 */
export enum ThresholdMode {
    Range = 'range',
    Absolute = 'absolute'
}

/**
 * Threshold configuration
 */
export interface ThresholdConfig {
    mode: ThresholdMode;
    range: [number, number];
}

/**
 * Configuration for a single layer
 */
export interface LayerConfig {
    /** Reference to the volume data */
    volumeId: string;
    
    /** Layer opacity [0.0 - 1.0] */
    opacity: number;
    
    /** Colormap index */
    colormapId: number;
    
    /** How to blend with layers below */
    blendMode: BlendMode;
    
    /** Intensity window (min, max) */
    intensityWindow: [number, number];
    
    /** Optional threshold range */
    threshold?: ThresholdConfig;
    
    /** Layer visibility */
    visible: boolean;
}

/**
 * Complete state for rendering a view
 */
export interface ViewState {
    /** Version for forward compatibility and validation */
    layoutVersion: number;
    
    /** Camera state in world coordinates */
    camera: CameraState;
    
    /** Crosshair position in world space */
    crosshairWorld: [number, number, number];
    
    /** Stack of layers to render */
    layers: LayerConfig[];
    
    /** Viewport dimensions */
    viewportSize: [number, number];
    
    /** Show/hide crosshair */
    showCrosshair: boolean;
}

/**
 * Result of a frame render request
 */
export interface FrameResult {
    /** Rendered image as PNG binary data */
    imageData: Uint8Array;
    
    /** Actual dimensions of rendered image */
    dimensions: [number, number];
    
    /** Time taken to render in milliseconds */
    renderTimeMs: number;
    
    /** Any warnings or non-fatal errors */
    warnings: string[];
    
    /** Layers that were actually rendered */
    renderedLayers: string[];
    
    /** Whether CPU fallback was used */
    usedCpuFallback: boolean;
}

/**
 * Current version of the ViewState layout
 */
export const VIEWSTATE_CURRENT_VERSION = 1;

/**
 * Create a default ViewState for a volume
 */
export function createDefaultViewState(
    volumeId: string, 
    volumeDims: [number, number, number]
): ViewState {
    // Calculate reasonable center
    const center: [number, number, number] = [
        volumeDims[0] * 0.5,
        volumeDims[1] * 0.5,
        volumeDims[2] * 0.5,
    ];
    
    return {
        layoutVersion: VIEWSTATE_CURRENT_VERSION,
        camera: {
            worldCenter: center,
            fovMm: 256.0,
            orientation: SliceOrientation.Axial,
        },
        crosshairWorld: center,
        layers: [{
            volumeId,
            opacity: 1.0,
            colormapId: 0,
            blendMode: BlendMode.Normal,
            intensityWindow: [0.0, 1.0],
            threshold: undefined,
            visible: true,
        }],
        viewportSize: [512, 512],
        showCrosshair: true,
    };
}

/**
 * Validate that the ViewState is well-formed
 */
export function validateViewState(state: ViewState): { valid: boolean; error?: string } {
    if (state.layoutVersion !== VIEWSTATE_CURRENT_VERSION) {
        return {
            valid: false,
            error: `Unsupported ViewState version ${state.layoutVersion}. Expected ${VIEWSTATE_CURRENT_VERSION}`
        };
    }
    
    if (state.viewportSize[0] === 0 || state.viewportSize[1] === 0) {
        return {
            valid: false,
            error: "Viewport dimensions must be non-zero"
        };
    }
    
    if (state.layers.length === 0) {
        return {
            valid: false,
            error: "At least one layer must be specified"
        };
    }
    
    for (let i = 0; i < state.layers.length; i++) {
        const layer = state.layers[i];
        if (layer.opacity < 0.0 || layer.opacity > 1.0) {
            return {
                valid: false,
                error: `Layer ${i} opacity must be in range [0,1]`
            };
        }
        
        if (layer.intensityWindow[0] >= layer.intensityWindow[1]) {
            return {
                valid: false,
                error: `Layer ${i} intensity window invalid: min >= max`
            };
        }
    }
    
    return { valid: true };
}

/**
 * Convert camera state to frame UBO parameters
 */
export function cameraToFrameParams(state: ViewState): {
    origin: [number, number, number, number];
    uVec: [number, number, number, number];
    vVec: [number, number, number, number];
} {
    const halfFov = state.camera.fovMm * 0.5;
    
    switch (state.camera.orientation) {
        case SliceOrientation.Axial:
            // Looking down Z axis, X->right, Y->up
            return {
                origin: [
                    state.camera.worldCenter[0] - halfFov,
                    state.camera.worldCenter[1] - halfFov,
                    state.camera.worldCenter[2],
                    1.0,
                ],
                uVec: [state.camera.fovMm, 0.0, 0.0, 0.0],
                vVec: [0.0, state.camera.fovMm, 0.0, 0.0],
            };
            
        case SliceOrientation.Coronal:
            // Looking down Y axis, X->right, Z->up
            return {
                origin: [
                    state.camera.worldCenter[0] - halfFov,
                    state.camera.worldCenter[1],
                    state.camera.worldCenter[2] - halfFov,
                    1.0,
                ],
                uVec: [state.camera.fovMm, 0.0, 0.0, 0.0],
                vVec: [0.0, 0.0, state.camera.fovMm, 0.0],
            };
            
        case SliceOrientation.Sagittal:
            // Looking down X axis, Y->right, Z->up
            return {
                origin: [
                    state.camera.worldCenter[0],
                    state.camera.worldCenter[1] - halfFov,
                    state.camera.worldCenter[2] - halfFov,
                    1.0,
                ],
                uVec: [0.0, state.camera.fovMm, 0.0, 0.0],
                vVec: [0.0, 0.0, state.camera.fovMm, 0.0],
            };
    }
}