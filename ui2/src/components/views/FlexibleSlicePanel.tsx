/**
 * FlexibleSlicePanel - Individual slice view panel for flexible layout mode
 * Wraps a SliceView for use in GoldenLayout
 */

import React, { useState, useEffect, useRef } from 'react';
import { SliceView } from './SliceView';
import type { ViewType } from '@/types/coordinates';

interface FlexibleSlicePanelProps {
  viewId?: ViewType;
  title?: string;
  containerWidth?: number;
  containerHeight?: number;
}

export function FlexibleSlicePanel({ viewId = 'axial', title, containerWidth, containerHeight }: FlexibleSlicePanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ 
    width: containerWidth || 512, 
    height: containerHeight || 512 
  });
  
  // Update dimensions when Golden Layout container dimensions change
  useEffect(() => {
    if (containerWidth && containerHeight) {
      console.log(`[FlexibleSlicePanel ${viewId}] Golden Layout dimensions: ${containerWidth}x${containerHeight}`);
      setDimensions({ width: containerWidth, height: containerHeight });
    }
  }, [containerWidth, containerHeight, viewId]);
  
  // Update dimensions when container resizes
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        console.log(`[FlexibleSlicePanel ${viewId}] Updating dimensions: ${rect.width}x${rect.height}`);
        setDimensions({
          width: Math.floor(rect.width),
          height: Math.floor(rect.height)
        });
      }
    };
    
    updateDimensions();
    
    // Listen for window resize (triggered by Golden Layout)
    window.addEventListener('resize', updateDimensions);
    
    // ResizeObserver for accurate container resize detection
    const resizeObserver = new ResizeObserver(() => {
      console.log(`[FlexibleSlicePanel ${viewId}] ResizeObserver triggered`);
      updateDimensions();
    });
    
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }
    
    return () => {
      window.removeEventListener('resize', updateDimensions);
      resizeObserver.disconnect();
    };
  }, [viewId]);
  
  return (
    <div ref={containerRef} className="h-full w-full bg-gray-900 flex flex-col">
      <SliceView
        viewId={viewId}
        width={dimensions.width}
        height={dimensions.height}
        className="h-full"
      />
    </div>
  );
}