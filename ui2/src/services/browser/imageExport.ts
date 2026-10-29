import {
  compose,
  encodeComposition,
  EXPORT_PRESETS,
  type ExportPane,
} from '../export/compositeExport';
import { BrowserSession, orientations } from './session';
import { DEFAULT_CROSSHAIR_COLOR } from '../../stores/crosshairSettingsStore';

/** Compose synchronously from the last complete presentation before encoding yields. */
export async function exportBrowserImage(session: BrowserSession): Promise<Uint8Array> {
  if (session.store.getState().view === 'surface') {
    if (!session.surfaceExporter) throw new Error('Wait for the surface to finish drawing.');
    return session.surfaceExporter({ format: 'png', transparentBackground: false });
  }
  const state = session.presentedState;
  if (!state || !orientations.every((view) => session.frames.has(view)))
    throw new Error('Wait for the image to finish drawing.');
  const selected = state.layers.find((layer) => layer.id === state.selected) ?? state.layers[0];
  const panes: ExportPane[] = orientations.map((view) => {
    const image = session.frames.get(view)!;
    return {
      image,
      width: image.width,
      height: image.height,
      plane: session.plane(view, image.width, state),
      framePlane: view,
      positionMm: state.crosshair[view === 'axial' ? 2 : view === 'coronal' ? 1 : 0],
      layerName: selected.name,
      crosshairWorld: state.crosshair,
    };
  });
  const composition = compose(
    [panes],
    {
      colorbar: selected.labelIds
        ? null
        : {
            layerId: selected.id,
            name: selected.name,
            colormap: selected.colormap ?? 'gray',
            intensity: selected.window,
            threshold: [0, 0],
            dataRange: { min: selected.range[0], max: selected.range[1] },
          },
      legend: selected.legend,
    },
    { ...EXPORT_PRESETS.shown, unit: 1 },
    {
      activeColor: DEFAULT_CROSSHAIR_COLOR,
      activeThickness: 1,
      activeStyle: 'solid',
    },
  );
  return encodeComposition(composition, 'png', 'black', {
    provenance: JSON.stringify({
      format: 'brainflow-browser-image',
      version: 1,
      crosshair: state.crosshair,
      layers: state.layers.map((layer) => ({
        name: layer.name,
        frame: layer.currentFrame,
        window: layer.window,
        opacity: layer.opacity,
        colormap: layer.colormap,
      })),
    }),
  });
}
