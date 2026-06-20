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
