import React, { useState, useEffect } from 'react';
import type { Layer, LayerRender } from '@/types/layers';
import { useLayerStore } from '@/stores/layerStore';
import { Slider, RangeSlider, ColormapSelector, IconButton, Badge, Tooltip, DropdownMenu } from '../ui';

interface LayerItemProps {
  layer: Layer;
  dragging?: boolean;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  onPatch: (patch: Partial<LayerRender>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onProperties: () => void;
}

export const LayerItem: React.FC<LayerItemProps> = ({
  layer,
  dragging = false,
  dragHandleProps = {},
  onPatch,
  onDelete,
  onDuplicate,
  onProperties
}) => {
  const layerStore = useLayerStore();
  const isSelected = useLayerStore(state => state.selectedLayerId === layer.id);
  const isLoading = useLayerStore(state => state.loadingLayers.has(layer.id));
  const error = useLayerStore(state => state.errorLayers.get(layer.id));
  const layerRender = useLayerStore(state => 
    state.layerRender.get(layer.id) || {
      opacity: 1.0,
      intensity: [0, 100] as [number, number],
      threshold: [0, 100] as [number, number],
      colormap: 'gray',
      interpolation: 'linear' as const,
    }
  );

  const [showDetails, setShowDetails] = useState(false);

  // GPU status indicator
  const gpuStatus = (() => {
    if (isLoading) return { color: 'yellow', label: 'Loading' };
    if (error) return { color: 'red', label: 'Error' };
    if (layer.visible) return { color: 'green', label: 'Active' };
    return { color: 'gray', label: 'Inactive' };
  })();

  function toggleVisibility() {
    layerStore.updateLayer(layer.id, { visible: !layer.visible });
  }

  function selectLayer() {
    layerStore.selectLayer(layer.id);
  }

  function handleOpacityChange(value: number) {
    onPatch({ opacity: value });
  }

  function handleIntensityChange(value: [number, number]) {
    onPatch({ intensity: value });
  }

  function handleThresholdChange(value: [number, number]) {
    onPatch({ threshold: value });
  }

  function handleColormapChange(value: string) {
    onPatch({ colormap: value });
  }

  function handleInterpolationChange(event: React.ChangeEvent<HTMLSelectElement>) {
    onPatch({ interpolation: event.target.value as 'nearest' | 'linear' });
  }


  const contextMenuItems = [
    {
      id: 'duplicate',
      label: 'Duplicate',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      ),
      onClick: onDuplicate
    },
    {
      id: 'properties',
      label: 'Properties',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      onClick: onProperties
    },
    {
      id: 'separator',
      label: '',
      separator: true
    },
    {
      id: 'delete',
      label: 'Delete',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      ),
      onClick: onDelete,
      danger: true
    }
  ];

  // Handle keyboard events
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isSelected && event.key === 'Delete') {
        onDelete();
      }
      if (event.key === 'Escape') {
        setShowDetails(false);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSelected, onDelete]);

  return (
    <>
      <div 
        className={`
          layer-item border-b border-gray-100 last:border-b-0 transition-all duration-100 ease-in-out
          ${isSelected ? 'bg-blue-50 border-blue-500' : ''}
          ${dragging ? 'opacity-50 transform rotate-2' : ''}
        `}
        onClick={selectLayer}
        role="button"
        tabIndex={0}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50">
          {/* Drag handle */}
          <div 
            className="drag-handle cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 touch-none"
            {...dragHandleProps}
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z"></path>
            </svg>
          </div>

          {/* Visibility toggle */}
          <Tooltip content={layer.visible ? 'Hide layer' : 'Show layer'}>
            <IconButton
              icon={layer.visible ? (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 12a2 2 0 100-4 2 2 0 000 4z"></path>
                  <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd"></path>
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd"></path>
                  <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z"></path>
                </svg>
              )}
              variant={layer.visible ? 'primary' : 'ghost'}
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                toggleVisibility();
              }}
              aria-label={layer.visible ? 'Hide layer' : 'Show layer'}
            />
          </Tooltip>

          {/* Layer info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm text-gray-900 truncate">{layer.name}</span>
              
              {/* Layer type badge */}
              <Badge variant="secondary" size="sm">
                {layer.type}
              </Badge>
            </div>
            
            {error && (
              <div className="text-xs text-red-600 truncate" title={error.message}>
                Error: {error.message}
              </div>
            )}
          </div>

          {/* GPU status indicator */}
          <div className="flex items-center gap-1">
            <Tooltip content={gpuStatus.label}>
              <Badge 
                variant={
                  gpuStatus.color === 'green' ? 'success' :
                  gpuStatus.color === 'yellow' ? 'warning' :
                  gpuStatus.color === 'red' ? 'danger' :
                  'default'
                }
                size="sm"
                dot
              />
            </Tooltip>
            
            {isLoading && (
              <div className="animate-spin w-3 h-3 border border-gray-300 border-t-blue-600 rounded-full"></div>
            )}
          </div>

          {/* Expand/collapse details */}
          <Tooltip content={showDetails ? 'Hide controls' : 'Show controls'}>
            <IconButton
              icon={
                <svg 
                  className={`w-4 h-4 transition-transform ${showDetails ? 'rotate-180' : ''}`}
                  fill="currentColor" 
                  viewBox="0 0 20 20"
                >
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"></path>
                </svg>
              }
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setShowDetails(!showDetails);
              }}
              aria-label={showDetails ? 'Hide controls' : 'Show controls'}
            />
          </Tooltip>

          {/* Context menu */}
          <DropdownMenu
            trigger={
              <IconButton
                icon={
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z"></path>
                  </svg>
                }
                variant="ghost"
                size="sm"
                aria-label="Layer options"
              />
            }
            items={contextMenuItems}
            position="bottom-right"
          />
        </div>

        {/* Details panel */}
        {showDetails && (
          <div className="px-3 py-3 bg-gray-50 space-y-3">
            {/* Opacity */}
            <Slider
              label="Opacity"
              min={0}
              max={1}
              step={0.01}
              value={layerRender.opacity}
              precision={2}
              onChange={handleOpacityChange}
            />

            {/* Intensity range */}
            <RangeSlider
              label="Intensity"
              min={0}
              max={255}
              value={layerRender.intensity}
              precision={0}
              onChange={handleIntensityChange}
            />

            {/* Threshold range */}
            <RangeSlider
              label="Threshold"
              min={0}
              max={255}
              value={layerRender.threshold}
              precision={0}
              onChange={handleThresholdChange}
            />

            {/* Colormap */}
            <ColormapSelector
              value={layerRender.colormap}
              onChange={handleColormapChange}
            />

            {/* Interpolation */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Interpolation</label>
              <select
                className="w-full px-3 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                value={layerRender.interpolation}
                onChange={handleInterpolationChange}
              >
                <option value="nearest">Nearest</option>
                <option value="linear">Linear</option>
              </select>
            </div>
          </div>
        )}
      </div>
    </>
  );
};