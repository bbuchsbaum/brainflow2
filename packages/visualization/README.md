# @brainflow/visualization

Reusable React visualization adapters extracted from the Brainflow desktop app.

## Exports

- `@brainflow/visualization/slice`: reusable slice viewport primitives,
  geometry helpers, drawing helpers, and the slice viewer controller hook.
- `@brainflow/visualization/surface`: reusable neurosurface canvas, surface
  renderable types, and the store-free surface reconciliation helpers.
- `@brainflow/visualization`: barrel export for both modules.

## Peer Dependencies

Consumers provide:

- `react` and `react-dom`
- `neurosurface` when using the surface viewer
- a normal browser canvas environment for slice rendering

The package does not import Brainflow `ui2` stores, Tauri commands, event buses,
or app services. Host apps pass data and callbacks through props.

## Minimal Integration

Slice viewers need a render surface, dimensions, a view plane, and optional
crosshair callbacks:

```tsx
import { ReusableSliceViewport, SliceViewerImageSurface } from '@brainflow/visualization/slice';

<ReusableSliceViewport
  width={512}
  height={512}
  viewPlane={viewPlane}
  crosshair={crosshair}
  renderSurface={(props) => <SliceViewerImageSurface {...props} image={image} />}
/>;
```

Surface viewers need typed-array geometry, a stable surface handle, layer specs,
settings, and optional activation/export hooks:

```tsx
import { NeuroSurfaceCanvas } from '@brainflow/visualization/surface';

<NeuroSurfaceCanvas
  surfaces={[surfaceRenderable]}
  width={800}
  height={600}
  projectionSettings={{ useGPUProjection: true }}
  onExporterChange={registerExporter}
/>;
```

Brainflow app wrappers remain in `ui2`; this package is the neutral viewer layer.

## Surface runtime contract

The `neurosurface` import is an npm alias for **SurfView 3.1.0** in this workspace.
The package supports compatible 3.x releases from 3.1.0 onward. Consumers must
provide the compatible Three.js peer (`^0.185.1`); Brainflow pins both runtime
dependencies in its workspace. The core viewer works through our React wrapper;
we do not use SurfView's optional React adapters (whose declared peers remain
React 18).

`src/surface/surfaceRuntime.ts` owns layer construction/updates and appearance
translation. Set the surface base color through `updateConfig({ color })`, never
through the mesh material color: the latter tints quantitative overlays. Lighting
uses the viewer's owned ambient/key/fill lights, with `headlight: false` to honor
Brainflow's world-position controls. GPU volume projection explicitly requests
linear sampling; hardware without float-linear support may use SurfView's
documented nearest fallback. The adapter no longer recomputes normals for every
appearance change. Grayscale aliases (`gray`, `grey`, `grays`) normalize to
`greys` on both layer paths, avoiding the volume texture generator's palette fallback.

The isolated `ui2/surfview-harness.html` exercises the real renderer with synthetic
data. See `e2e/playwright.surfview.config.ts`; it is a development entry point,
not part of the production app or evidence of native Tauri acceptance.
