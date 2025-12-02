# Surface Visualization Parity Plan

Overview: Align surface visualization with volume capabilities using shared UI controls and a unified layer model. Keep reuse high (SharedControls, common layer list) and map updates to neurosurface (MultiLayerNeuroSurface) via a thin adapter.

- [ ] Define a shared layer DTO for UI/state: scalar/label/rgba/outline with fields for intensity, threshold, colormap, opacity, blendMode, order, visibility, labelDefs/halo options.
- [ ] Add a surface layer store slice (mirroring volume API) with setters/getters for shared layer fields; keep geometry separate.
- [ ] Extract a reusable LayerList+Controls component (selection, visibility, ordering) that uses SharedControls for scalar/rgba and small panels for label/outline.
- [ ] Refactor SurfacePanel to use the shared LayerList+Controls; keep geometry controls above.
- [ ] Implement SurfaceRenderingService adapter that maps shared layer updates to neurosurface layers (DataLayer, LabelLayer, RGBALayer, OutlineLayer), preserving order and blend/opacity.
- [ ] Add blend mode selector and layer ordering controls (shared with volume UI).
- [ ] Add label/outline toggles (outline/halo color/width) for label layers.
- [ ] Validate GPU compositor path (cap at 8 visible layers, fallback to CPU) and basic scenarios (multi scalar overlays, label with outline/halo, opacity/threshold updates).
