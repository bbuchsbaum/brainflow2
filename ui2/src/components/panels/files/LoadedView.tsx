import React, { useMemo } from 'react';
import './FlatList.css';
import { useLayerStore, type LayerInfo } from '@/stores/layerStore';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { useInspectorSelectionStore } from '@/stores/inspectorSelectionStore';
import { beginLayerRowDrag } from '@/utils/layerDrag';
import type { SceneItem } from '@/types/sceneItem';
import { inferFileType } from './shared/inferFileType';
import { FlatFileRow } from './FlatFileRow';
import { useRovingFocus } from '@/components/ui/bf';
import { useContextMenuStore } from '@/stores/contextMenuStore';
import { removeLayerFromScene } from '@/services/layerRemoval';

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
  const ids = useMemo(() => layers.map((l) => l.id), [layers]);
  const roving = useRovingFocus({ ids, activeId: selectedLayerId });

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

  function handleDragPointerDown(event: React.PointerEvent, layer: LayerInfo) {
    beginLayerRowDrag(event, layer.id, layer.name);
  }

  return (
    <div
      className="fb-flat-list"
      role="listbox"
      aria-label="Loaded layers"
      onKeyDown={roving.onKeyDown}
    >
      {layers.map((layer) => {
        const sourcePath = layer.sourcePath ?? '';
        const isFourD = layer.volumeType === 'TimeSeries4D';
        const meta: string[] = [];
        if (layer.source) meta.push(layer.source);
        if (isFourD && layer.timeSeriesInfo) {
          meta.push(`${layer.timeSeriesInfo.num_timepoints}t`);
        }
        return (
          <FlatFileRow
            key={layer.id}
            roving={roving.getItemProps(layer.id)}
            selected={layer.id === selectedLayerId}
            onSelect={() => {
              setActive(buildVolumeSceneItem(layer, layers));
              if (sourcePath) selectFile(sourcePath);
            }}
            info={inferFileType(sourcePath || layer.name, false, { isFourD })}
            name={layer.name}
            meta={meta.length > 0 ? meta.join(' · ') : undefined}
            title={sourcePath || layer.name}
            onDragPointerDown={(event) => handleDragPointerDown(event, layer)}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              useContextMenuStore.getState().open(event.clientX, event.clientY, [
                {
                  id: 'loaded.unload',
                  label: 'Unload',
                  danger: true,
                  onClick: () => void removeLayerFromScene(layer.id),
                },
              ]);
            }}
          />
        );
      })}
    </div>
  );
};
