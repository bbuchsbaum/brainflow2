/**
 * LightboxView Component
 * Displays all slices in a grid layout
 */

import React, { useMemo } from 'react';
import { SliceView } from './SliceView';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { getSliceNavigationService } from '@/services/SliceNavigationService';
import type { ViewType } from '@/types/coordinates';

interface LightboxViewProps {
  orientation?: ViewType;
  thumbnailSize?: number;
  containerWidth?: number;
  containerHeight?: number;
}

export function LightboxView({ 
  orientation = 'axial',
  thumbnailSize = 128,
  containerWidth = 800,
  containerHeight = 600 
}: LightboxViewProps) {
  const layers = useLayerStore(state => state.layers);
  const viewState = useViewStateStore(state => state.viewState);
  const sliceNavService = getSliceNavigationService();
  
  // Get slice range from navigation service
  const sliceRange = useMemo(() => {
    try {
      return sliceNavService.getSliceRange(orientation);
    } catch (error) {
      console.warn(`[LightboxView] Failed to get slice range for ${orientation}`, error);
      return { min: -100, max: 100, step: 1, current: 0 };
    }
  }, [orientation, layers, viewState.crosshair.world_mm]);
  
  // Calculate total slices and grid layout
  const totalSlices = Math.floor((sliceRange.max - sliceRange.min) / sliceRange.step) + 1;
  const columns = Math.floor((containerWidth - 40) / (thumbnailSize + 8)); // 8px gap
  const rows = Math.ceil(totalSlices / columns);
  
  // Generate all slice positions
  const slicePositions = useMemo(() => {
    const positions: number[] = [];
    for (let i = 0; i < totalSlices; i++) {
      const slicePosition = sliceRange.min + (i * sliceRange.step);
      positions.push(slicePosition);
    }
    return positions;
  }, [totalSlices, sliceRange]);
  
  // Find which slice contains current crosshair
  const currentSliceIndex = useMemo(() => {
    const axisIndex = orientation === 'axial' ? 2 : orientation === 'sagittal' ? 0 : 1;
    const currentPos = viewState.crosshair.world_mm[axisIndex];
    return Math.round((currentPos - sliceRange.min) / sliceRange.step);
  }, [viewState.crosshair.world_mm, sliceRange, orientation]);
  
  // Handle slice click - update crosshair
  const handleSliceClick = (slicePosition: number) => {
    const currentCrosshair = [...viewState.crosshair.world_mm];
    
    // Update the appropriate axis based on orientation
    const axisIndex = orientation === 'axial' ? 2 : orientation === 'sagittal' ? 0 : 1;
    currentCrosshair[axisIndex] = slicePosition;
    
    // Update through navigation service
    sliceNavService.setWorldPosition(currentCrosshair[0], currentCrosshair[1], currentCrosshair[2]);
  };
  
  return (
    <div className="h-full bg-gray-900 p-4 overflow-auto">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm text-gray-400">
          {totalSlices} slices • {orientation.charAt(0).toUpperCase() + orientation.slice(1)} view
        </h3>
        <div className="text-xs text-gray-500">
          Current: Slice {currentSliceIndex + 1} of {totalSlices}
        </div>
      </div>
      
      {/* Grid of slices */}
      <div 
        className="grid gap-2"
        style={{
          gridTemplateColumns: `repeat(${columns}, ${thumbnailSize}px)`,
          justifyContent: 'center'
        }}
      >
        {slicePositions.map((slicePos, index) => {
          // Create a unique view ID for this grid cell
          const viewId = `${orientation}-lightbox-${index}` as ViewType;
          const isCurrentSlice = index === currentSliceIndex;
          
          return (
            <div 
              key={index}
              className={`
                relative bg-gray-800 rounded overflow-hidden cursor-pointer
                transition-all hover:ring-2 hover:ring-blue-500
                ${isCurrentSlice ? 'ring-2 ring-green-500' : ''}
              `}
              onClick={() => handleSliceClick(slicePos)}
              style={{
                width: thumbnailSize,
                height: thumbnailSize
              }}
            >
              {/* Slice label */}
              <div className="absolute top-0.5 left-0.5 z-10 bg-black/70 px-1 py-0.5 rounded text-[10px] text-gray-300">
                {index + 1}
              </div>
              
              {/* Position indicator */}
              <div className="absolute bottom-0.5 right-0.5 z-10 bg-black/70 px-1 py-0.5 rounded text-[10px] text-gray-400">
                {slicePos.toFixed(0)}mm
              </div>
              
              {/* Slice view */}
              <SliceView
                viewId={viewId}
                width={thumbnailSize}
                height={thumbnailSize}
                overrideSlicePosition={slicePos}
                orientation={orientation}
              />
            </div>
          );
        })}
      </div>
      
      {/* Info footer */}
      <div className="mt-4 p-3 bg-gray-800 rounded text-xs text-gray-400">
        <p>Click any slice to jump to that location</p>
        <p className="mt-1">Green border indicates current crosshair position</p>
      </div>
    </div>
  );
}