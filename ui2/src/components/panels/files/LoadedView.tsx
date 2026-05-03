import React from 'react';
import { useLayerStore } from '@/stores/layerStore';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { inferFileType } from './shared/inferFileType';
import { FileTypeBadge } from './shared/FileTypeBadge';

export const LoadedView: React.FC = () => {
  const layers = useLayerStore((state) => state.layers);
  const selectedLayerId = useLayerStore((state) => state.selectedLayerId);
  const selectLayer = useLayerStore((state) => state.selectLayer);
  const selectFile = useFileBrowserStore((state) => state.selectFile);

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
              onClick={() => {
                selectLayer(layer.id);
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
