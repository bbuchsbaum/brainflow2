import React from 'react';
import './FlatList.css';
import { useLayerStore, type LayerInfo } from '@/stores/layerStore';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { useInspectorSelectionStore } from '@/stores/inspectorSelectionStore';
import { LAYER_DRAG_MIME, serializeLayerDragData } from '@/utils/layerDrag';
import type { SceneItem } from '@/types/sceneItem';
import { inferFileType } from './shared/inferFileType';
import { FileTypeBadge } from './shared/FileTypeBadge';

function buildVolumeSceneItem(
  layer: LayerInfo,
  layers: ReadonlyArray<LayerInfo>
): SceneItem {
  const isAtlas = layer.source === 'atlas';
  let kind: SceneItem['kind'];
  if (isAtlas) {
    kind = 'volume-overlay-atlas';
  } else {
    const firstNonAtlas = layers.find((l) => l.source !== 'atlas');
    kind = firstNonAtlas?.id === layer.id ? 'volume-base' : 'volume-overlay';
  }
  return {
    id: layer.id,
    kind,
    group: 'volume',
    name: layer.name,
    subtitle: '',
    visible: layer.visible,
    opacity: 1,
    ref: { type: 'volume', layerId: layer.id },
  };
}

export const LoadedView: React.FC = () => {
  const layers = useLayerStore((state) => state.layers);
  const selectedLayerId = useLayerStore((state) => state.selectedLayerId);
  const selectFile = useFileBrowserStore((state) => state.selectFile);
  const setActive = useInspectorSelectionStore((state) => state.setActive);

  if (layers.length === 0) {
    return (
      <div className="fb-flat-empty" role="status">
        <p className="fb-flat-empty-kicker">No layers loaded</p>
        <p className="fb-flat-empty-message">
          Open a file from the Tree or Images view, or drop one onto the panel.
        </p>
      </div>
    );
  }

  function handleDragStart(event: React.DragEvent, layer: LayerInfo) {
    if (!event.dataTransfer) return;
    event.stopPropagation();

    const payload = serializeLayerDragData({ layerId: layer.id });
    event.dataTransfer.setData(LAYER_DRAG_MIME, payload);
    event.dataTransfer.setData('application/json', payload);
    event.dataTransfer.effectAllowed = 'copy';
  }

  return (
    <ul className="fb-flat-list" role="list">
      {layers.map((layer) => {
        const sourcePath = layer.sourcePath ?? '';
        const isFourD = layer.volumeType === 'TimeSeries4D';
        const info = inferFileType(sourcePath || layer.name, false, { isFourD });
        const isSelected = layer.id === selectedLayerId;
        const meta: string[] = [];
        if (layer.source) meta.push(layer.source);
        if (isFourD && layer.timeSeriesInfo) {
          meta.push(`${layer.timeSeriesInfo.num_timepoints}t`);
        }
        return (
          <li key={layer.id}>
            <button
              type="button"
              className={`fb-flat-row${isSelected ? ' is-selected' : ''}`}
              title={sourcePath || layer.name}
              draggable
              onDragStart={(event) => handleDragStart(event, layer)}
              onClick={() => {
                setActive(buildVolumeSceneItem(layer, layers));
                if (sourcePath) selectFile(sourcePath);
              }}
            >
              <FileTypeBadge info={info} />
              <span className="fb-flat-row-name">{layer.name}</span>
              {meta.length > 0 && (
                <span className="fb-flat-row-meta">{meta.join(' · ')}</span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
};
