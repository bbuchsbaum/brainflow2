export const DEFAULT_NEURO_SURFACE_LIGHTING_SETTINGS = {
    ambientLightIntensity: 0.4,
    directionalLightIntensity: 1.0,
    fillLightIntensity: 0.5,
    lightPosition: [100, 100, 100],
};
export const DEFAULT_NEURO_SURFACE_DISPLAY_SETTINGS = {
    wireframe: false,
    opacity: 1,
    smoothing: 0,
    flatShading: false,
};
export const DEFAULT_NEURO_SURFACE_MATERIAL_SETTINGS = {
    surfaceColor: '#CCCCCC',
    shininess: 30,
    specularColor: '#ffffff',
    emissiveColor: '#000000',
    emissiveIntensity: 0,
};
export const DEFAULT_NEURO_SURFACE_PROJECTION_SETTINGS = {
    useGPUProjection: false,
};
export const DEFAULT_NEURO_SURFACE_VIEW_SETTINGS = {
    lightingSettings: DEFAULT_NEURO_SURFACE_LIGHTING_SETTINGS,
    displaySettings: DEFAULT_NEURO_SURFACE_DISPLAY_SETTINGS,
    materialSettings: DEFAULT_NEURO_SURFACE_MATERIAL_SETTINGS,
    projectionSettings: DEFAULT_NEURO_SURFACE_PROJECTION_SETTINGS,
};
//# sourceMappingURL=types.js.map