# Surface Viewer Compatibility Layer

`surfaceViewer/` preserves Brainflow's historical local import paths. The
store-free implementation is owned by `@brainflow/visualization/surface`.

## Minimal Inputs

Use `NeuroSurfaceCanvas` from `@brainflow/visualization/surface` with:

- `surfaces`: one or more `SurfaceRenderable` objects. Each object needs a
  stable `handle`, typed-array `geometry.vertices`, typed-array
  `geometry.faces`, and `layers` as either an array or `Map`.
- Layer specs: scalar layers provide `values` plus optional `indices`;
  categorical/precolored layers provide `rgba`; GPU projection layers provide
  `volumeData`, `volumeDims`, and optional `affineMatrix`.
- View settings: `viewpoint`, `showControls`, `lightingSettings`,
  `displaySettings`, `materialSettings`, and `projectionSettings`.
- Integration hooks: `onActivate`, `onContextMenu`, `onExporterChange`, and an
  optional `renderSignal` value that requests a redraw when it changes.

Brainflow-specific concerns stay outside this module:

- Zustand `surfaceStore` selection and per-view settings.
- `ViewExportService` registration.
- `EventBus` overlay notifications.
- GoldenLayout/panel activation and context menus.

`surfaceViewReconciler.ts` at the parent level remains a compatibility export.
New reusable implementation work belongs in `packages/visualization/src/surface`;
Brainflow app-specific wrapper work belongs in `SurfaceViewCanvas.tsx` and
`SurfaceViewPanel.tsx`.
