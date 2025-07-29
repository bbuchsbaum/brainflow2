/**
 * RenderOverlays Component
 * 
 * Shared component for rendering overlays on top of slice views.
 * Includes crosshairs, labels, and other UI elements.
 * 
 * This component is view-agnostic and can be used by any rendering component.
 */

import React from 'react';
import type { ViewState } from '@/types/viewState';
import type { ImagePlacement } from '@/utils/canvasUtils';

interface RenderOverlaysProps {
  viewType: 'axial' | 'sagittal' | 'coronal';
  imagePlacement: ImagePlacement | null;
  showCrosshair: boolean;
  crosshairPosition: number[];
  viewState: ViewState;
}

export function RenderOverlays({
  viewType,
  imagePlacement,
  showCrosshair,
  crosshairPosition,
  viewState
}: RenderOverlaysProps) {
  if (!imagePlacement || !showCrosshair) {
    return null;
  }
  
  // Get the view plane for this view type
  const viewPlane = viewState.views[viewType];
  if (!viewPlane) return null;
  
  // Calculate crosshair position in view coordinates
  // This is a simplified version - full implementation would project
  // the 3D crosshair position onto the 2D view plane
  const crosshairX = imagePlacement.x + imagePlacement.width / 2;
  const crosshairY = imagePlacement.y + imagePlacement.height / 2;
  
  return (
    <svg 
      className="absolute inset-0 pointer-events-none"
      style={{ width: '100%', height: '100%' }}
    >
      {/* Vertical crosshair line */}
      <line
        x1={crosshairX}
        y1={imagePlacement.y}
        x2={crosshairX}
        y2={imagePlacement.y + imagePlacement.height}
        stroke="yellow"
        strokeWidth="1"
        opacity="0.8"
      />
      
      {/* Horizontal crosshair line */}
      <line
        x1={imagePlacement.x}
        y1={crosshairY}
        x2={imagePlacement.x + imagePlacement.width}
        y2={crosshairY}
        stroke="yellow"
        strokeWidth="1"
        opacity="0.8"
      />
      
      {/* Center dot */}
      <circle
        cx={crosshairX}
        cy={crosshairY}
        r="3"
        fill="yellow"
        opacity="0.8"
      />
      
      {/* View type label */}
      <text
        x="10"
        y="20"
        fill="white"
        fontSize="14"
        fontFamily="monospace"
        opacity="0.8"
      >
        {viewType.charAt(0).toUpperCase() + viewType.slice(1)}
      </text>
      
      {/* Coordinate display */}
      <text
        x="10"
        y="40"
        fill="white"
        fontSize="12"
        fontFamily="monospace"
        opacity="0.6"
      >
        {`[${crosshairPosition.map(v => v.toFixed(1)).join(', ')}]`}
      </text>
    </svg>
  );
}