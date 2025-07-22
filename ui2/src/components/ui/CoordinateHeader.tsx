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
    <div className="bg-gray-800 text-white px-4 py-2 flex items-center justify-between text-sm">
      <div className="flex items-center space-x-6">
        <span className="text-gray-400">Coordinates (mm):</span>
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
      <div className="text-xs text-gray-500">
        LPI Coordinate System
      </div>
    </div>
  );
}