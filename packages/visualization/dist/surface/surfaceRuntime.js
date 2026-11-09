import { DataLayer, RGBALayer, VolumeProjectionLayer, } from 'neurosurface';
function surfaceColormap(name = 'viridis') {
    // ColorMap accepts these aliases, but the volume texture generator requires
    // the canonical preset name or silently falls back to a different palette.
    return ['gray', 'grey', 'grays'].includes(name.toLowerCase()) ? 'greys' : name;
}
/**
 * Where a volume layer samples: at `samplingPositions` (one-sample ribbon,
 * the folded mesh standing in for an inflated one) or at the drawn vertices.
 */
function anatomicalSampling(spec) {
    const positions = spec.samplingPositions;
    return positions
        ? {
            projectionMode: 'ribbon',
            ribbon: { pial: positions, white: positions, samples: 1 },
        }
        : { projectionMode: 'vertex' };
}
export function buildLayerInstance(spec) {
    switch (spec.kind) {
        case 'rgba':
            return new RGBALayer(spec.id, spec.rgba ?? new Float32Array(0), {
                opacity: spec.opacity,
            });
        case 'volume':
            return new VolumeProjectionLayer(spec.id, new Float32Array(spec.volumeData ?? []), spec.volumeDims ?? [1, 1, 1], {
                // Before 3.x, GPU projection interpolated even with a nearest default.
                // Specify linear for consistent smooth sampling on both CPU and GPU.
                sampling: 'linear',
                affineMatrix: spec.affineMatrix,
                colormap: surfaceColormap(spec.colormap || 'viridis'),
                range: spec.range,
                threshold: spec.threshold,
                opacity: spec.opacity,
                ...anatomicalSampling(spec),
            });
        case 'data':
        default:
            return new DataLayer(spec.id, spec.values ?? new Float32Array(0), spec.indices ?? null, surfaceColormap(spec.colormap || 'viridis'), {
                range: spec.range,
                threshold: spec.threshold,
                opacity: spec.opacity,
            });
    }
}
export function applyLayerUpdate(renderedSurface, spec) {
    switch (spec.kind) {
        case 'rgba':
            renderedSurface.updateLayer(spec.id, {
                rgbaData: spec.rgba,
                opacity: spec.opacity,
            });
            return;
        case 'volume':
            renderedSurface.updateLayer(spec.id, {
                volumeData: spec.volumeData ? new Float32Array(spec.volumeData) : undefined,
                colorMap: surfaceColormap(spec.colormap || 'viridis'),
                sampling: 'linear',
                range: spec.range,
                threshold: spec.threshold,
                affineMatrix: spec.affineMatrix,
                opacity: spec.opacity,
                ...anatomicalSampling(spec),
            });
            return;
        case 'data':
        default:
            renderedSurface.updateLayer(spec.id, {
                data: spec.values,
                indices: spec.indices ?? undefined,
                colorMap: surfaceColormap(spec.colormap || 'viridis'),
                range: spec.range,
                threshold: spec.threshold,
                opacity: spec.opacity,
            });
    }
}
export function applySurfaceRenderSettings(surface, display, material) {
    surface.updateConfig({
        // SurfView 3.x colors the base layer here, leaving data colors untinted.
        color: material.surfaceColor,
        alpha: display.opacity,
        flatShading: display.flatShading,
        shininess: material.shininess,
        specularColor: Number.parseInt(material.specularColor.replace('#', ''), 16),
        emissive: material.emissiveColor,
        emissiveIntensity: material.emissiveIntensity,
    });
    const materials = surface.mesh?.material;
    for (const meshMaterial of Array.isArray(materials) ? materials : [materials]) {
        if (meshMaterial && 'wireframe' in meshMaterial) {
            meshMaterial.wireframe = display.wireframe;
            meshMaterial.needsUpdate = true;
        }
    }
}
export function applySceneRenderSettings(viewer, settings) {
    // Preserve Brainflow's world-space light-position control: a camera headlight
    // would overwrite the requested position on every frame.
    viewer.setHeadlight(false);
    viewer.updateConfig({ directionalLightIntensity: settings.directionalLightIntensity });
    viewer.ambientLight.intensity = settings.ambientLightIntensity;
    viewer.directionalLight.position.set(...settings.lightPosition);
    viewer.fillLight.intensity = settings.fillLightIntensity ?? 0;
    viewer.fillLight.position.set(-100, -100, -50);
}
//# sourceMappingURL=surfaceRuntime.js.map