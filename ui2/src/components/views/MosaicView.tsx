/**
 * MosaicView Component
 * Displays a grid of brain slices with navigation controls
 */

import React, { useState, useEffect, useMemo } from 'react';
import { SliceView } from './SliceView';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { SliceSlider } from '../ui/SliceSlider';
import { getSliceNavigationService } from '@/services/SliceNavigationService';
import type { ViewType } from '@/types/coordinates';

interface MosaicViewProps {
  rows?: number;
  columns?: number;
  orientation?: ViewType;
  containerWidth?: number;
  containerHeight?: number;
}

export function MosaicView({ 
  rows = 3, 
  columns = 3, 
  orientation = 'axial',
  containerWidth = 800,
  containerHeight = 600 
}: MosaicViewProps) {
  const layers = useLayerStore(state => state.layers);
  const viewState = useViewStateStore(state => state.viewState);
  const sliceNavService = getSliceNavigationService();
  
  // Calculate grid dimensions
  const gridSize = rows * columns;
  const cellWidth = Math.floor((containerWidth - 40) / columns); // Account for padding
  const cellHeight = Math.floor((containerHeight - 80) / rows); // Account for slider
  
  // Get slice range from navigation service
  const sliceRange = useMemo(() => {
    try {
      return sliceNavService.getSliceRange(orientation);
    } catch (error) {
      console.warn(`[MosaicView] Failed to get slice range for ${orientation}`, error);
      return { min: -100, max: 100, step: 1, current: 0 };
    }
  }, [orientation, layers, viewState.crosshair.world_mm]);
  
  // Calculate total slices and pages
  const totalSlices = Math.floor((sliceRange.max - sliceRange.min) / sliceRange.step) + 1;
  const totalPages = Math.ceil(totalSlices / gridSize);
  
  // Current page state
  const [currentPage, setCurrentPage] = useState(0);
  
  // Calculate which slices to show
  const startSliceIndex = currentPage * gridSize;
  const endSliceIndex = Math.min(startSliceIndex + gridSize, totalSlices);
  
  // Generate slice positions for current page
  const slicePositions = useMemo(() => {
    const positions: number[] = [];
    for (let i = startSliceIndex; i < endSliceIndex; i++) {
      const slicePosition = sliceRange.min + (i * sliceRange.step);
      positions.push(slicePosition);
    }
    return positions;
  }, [startSliceIndex, endSliceIndex, sliceRange]);
  
  // Update page when crosshair changes
  useEffect(() => {
    const currentSliceIndex = Math.floor((sliceRange.current - sliceRange.min) / sliceRange.step);
    const newPage = Math.floor(currentSliceIndex / gridSize);
    if (newPage !== currentPage && newPage >= 0 && newPage < totalPages) {
      setCurrentPage(newPage);
    }
  }, [sliceRange.current, sliceRange.min, sliceRange.step, gridSize, totalPages, currentPage]);
  
  // Handle slice click - update crosshair
  const handleSliceClick = (slicePosition: number) => {
    const currentCrosshair = [...viewState.crosshair.world_mm];
    
    // Update the appropriate axis based on orientation
    const axisIndex = orientation === 'axial' ? 2 : orientation === 'sagittal' ? 0 : 1;
    currentCrosshair[axisIndex] = slicePosition;
    
    // Update through navigation service
    sliceNavService.setWorldPosition(currentCrosshair[0], currentCrosshair[1], currentCrosshair[2]);
  };
  
  // Navigation handlers
  const handlePageChange = (newPage: number) => {
    if (newPage >= 0 && newPage < totalPages) {
      setCurrentPage(newPage);
    }
  };
  
  const handleSliderChange = (value: number) => {
    const newPage = Math.floor(value);
    handlePageChange(newPage);
  };
  
  return (
    <div className="flex flex-col h-full bg-gray-900 p-4">
      {/* Grid of slices */}
      <div 
        className="flex-1 grid gap-2 mb-4"
        style={{
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          gridTemplateRows: `repeat(${rows}, 1fr)`
        }}
      >
        {slicePositions.map((slicePos, index) => {
          // Create a unique view ID for this grid cell
          const viewId = `${orientation}-mosaic-${index}` as ViewType;
          
          return (
            <div 
              key={`${currentPage}-${index}`}
              className="relative bg-gray-800 rounded overflow-hidden cursor-pointer hover:ring-2 hover:ring-blue-500 transition-all"
              onClick={() => handleSliceClick(slicePos)}
            >
              {/* Slice label */}
              <div className="absolute top-1 left-1 z-10 bg-black/70 px-2 py-0.5 rounded text-xs text-gray-300">
                {orientation} {slicePos.toFixed(1)}mm
              </div>
              
              {/* Slice view */}
              <SliceView
                viewId={viewId}
                width={cellWidth}
                height={cellHeight}
                overrideSlicePosition={slicePos}
                orientation={orientation}
              />
            </div>
          );
        })}
        
        {/* Empty cells if grid not full */}
        {Array.from({ length: gridSize - slicePositions.length }).map((_, index) => (
          <div 
            key={`empty-${index}`}
            className="bg-gray-800/50 rounded"
          />
        ))}
      </div>
      
      {/* Navigation controls */}
      <div className="flex items-center gap-4">
        {/* Page navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage === 0}
            className="px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded text-sm transition-colors"
          >
            ← Prev
          </button>
          
          <span className="text-sm text-gray-400 min-w-[100px] text-center">
            Page {currentPage + 1} of {totalPages}
          </span>
          
          <button
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage === totalPages - 1}
            className="px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded text-sm transition-colors"
          >
            Next →
          </button>
        </div>
        
        {/* Page slider */}
        <div className="flex-1">
          <SliceSlider
            min={0}
            max={Math.max(0, totalPages - 1)}
            step={1}
            value={currentPage}
            onChange={handleSliderChange}
            label={`Navigate Pages (${totalSlices} total slices)`}
            showValue={false}
          />
        </div>
        
        {/* Info */}
        <div className="text-xs text-gray-500">
          Showing slices {startSliceIndex + 1}-{endSliceIndex} of {totalSlices}
        </div>
      </div>
    </div>
  );
}