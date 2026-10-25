/**
 * CoordinateHeader Component
 * Displays the current crosshair position in world coordinates
 */

import React from 'react';
import { useViewStateStore } from '@/stores/viewStateStore';

export function CoordinateHeader() {
  const crosshair = useViewStateStore(state => state.viewState.crosshair);
  
  const formatCoordinate = (value: number) => {
    return value.toFixed(1);
  };
  
  return (
    <div className="bg-card text-foreground px-4 py-2 flex items-center justify-between text-bf-sm">
      <div className="flex items-center space-x-6">
        <span className="text-bf-text-secondary">Coordinates (mm):</span>
        <div className="flex space-x-4 font-mono">
          <span className="text-red-400">
            X: {formatCoordinate(crosshair.world_mm[0])}
          </span>
          <span className="text-green-400">
            Y: {formatCoordinate(crosshair.world_mm[1])}
          </span>
          <span className="text-blue-400">
            Z: {formatCoordinate(crosshair.world_mm[2])}
          </span>
        </div>
      </div>
      <div className="text-bf-xs text-muted-foreground">
        RAS Coordinate System
      </div>
    </div>
  );
}