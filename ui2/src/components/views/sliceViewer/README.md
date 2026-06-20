# Slice Viewer Compatibility Layer

This directory preserves Brainflow's historical local import paths. The
store-free implementation is owned by `@brainflow/visualization/slice`.

Reusable package exports:
- `ReusableSliceViewport` composes a caller-supplied render surface with viewport placement, crosshair overlay, slice-border drawing, and world-click callbacks.
- `SliceViewerImageSurface` is a store-free canvas surface for apps that already have an `ImageBitmap` and render state.
- `geometry` helpers own placement-aware image/world/canvas coordinate conversion.
- `drawing` helpers own canvas-only crosshair and slice-border drawing.

Brainflow-specific behavior stays outside this directory:
- `../SliceViewport.tsx` registers `RenderContext` with the render-state store and injects the Brainflow `SliceRenderer`.
- Orthogonal, comparison, and mosaic scheduling stay in their current services/components.
- Mosaic mirror-crosshair styling remains in `../MosaicCell.tsx` because it depends on mosaic slice-position policy and workspace settings.

Do not add new reusable implementation here. Add it in
`packages/visualization/src/slice` and keep these files as compatibility
re-exports.
