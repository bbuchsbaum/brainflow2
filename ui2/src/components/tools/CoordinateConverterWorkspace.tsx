/**
 * CoordinateConverterWorkspace Component
 * Simple tool for converting between coordinate systems
 */

import React, { useState } from 'react';
import { useLayerStore } from '@/stores/layerStore';

type CoordinateSystem = 'world' | 'voxel' | 'mni' | 'tal';

interface Coordinates {
  x: number;
  y: number;
  z: number;
}

export function CoordinateConverterWorkspace() {
  const layers = useLayerStore(state => state.layers);
  const layerMetadata = useLayerStore(state => state.layerMetadata);
  
  const [sourceSystem, setSourceSystem] = useState<CoordinateSystem>('world');
  const [targetSystem, setTargetSystem] = useState<CoordinateSystem>('voxel');
  const [inputCoords, setInputCoords] = useState<Coordinates>({ x: 0, y: 0, z: 0 });
  const [outputCoords, setOutputCoords] = useState<Coordinates>({ x: 0, y: 0, z: 0 });
  
  // Get active layer for voxel size info
  const activeLayer = layers.find(l => l.visible);
  const metadata = activeLayer ? layerMetadata.get(activeLayer.id) : undefined;
  const voxelSize = metadata?.voxelSizes || [1, 1, 1];
  
  // Conversion function (simplified - in reality would use affine transforms)
  const convertCoordinates = () => {
    let result = { ...inputCoords };
    
    // Simple conversions for demo
    if (sourceSystem === 'world' && targetSystem === 'voxel') {
      result = {
        x: Math.round(inputCoords.x / voxelSize[0]),
        y: Math.round(inputCoords.y / voxelSize[1]),
        z: Math.round(inputCoords.z / voxelSize[2])
      };
    } else if (sourceSystem === 'voxel' && targetSystem === 'world') {
      result = {
        x: inputCoords.x * voxelSize[0],
        y: inputCoords.y * voxelSize[1],
        z: inputCoords.z * voxelSize[2]
      };
    } else if (sourceSystem === targetSystem) {
      // Same system, no conversion
      result = inputCoords;
    } else {
      // For other conversions, just add/subtract offsets as demo
      const offset = sourceSystem === 'mni' ? -90 : sourceSystem === 'tal' ? -100 : 0;
      const newOffset = targetSystem === 'mni' ? 90 : targetSystem === 'tal' ? 100 : 0;
      result = {
        x: inputCoords.x - offset + newOffset,
        y: inputCoords.y - offset + newOffset,
        z: inputCoords.z - offset + newOffset
      };
    }
    
    setOutputCoords(result);
  };
  
  const handleInputChange = (axis: keyof Coordinates, value: string) => {
    const numValue = parseFloat(value) || 0;
    setInputCoords(prev => ({ ...prev, [axis]: numValue }));
  };
  
  const coordinateSystemLabels: Record<CoordinateSystem, string> = {
    world: 'World (mm)',
    voxel: 'Voxel (indices)',
    mni: 'MNI-152',
    tal: 'Talairach'
  };
  
  return (
    <div className="h-full bg-gray-900 text-gray-100 p-6 overflow-auto">
      <h2 className="text-xl font-semibold mb-6">Coordinate Converter</h2>
      
      {/* Active Volume Info */}
      <div className="mb-6 p-4 bg-gray-800 rounded">
        <h3 className="text-sm font-medium text-gray-400 mb-2">Reference Volume</h3>
        {activeLayer ? (
          <div className="space-y-1">
            <p className="text-sm">{activeLayer.name}</p>
            <p className="text-xs text-gray-500">
              Voxel size: {voxelSize.map(v => v.toFixed(2)).join(' × ')} mm
            </p>
            {metadata?.dimensions && (
              <p className="text-xs text-gray-500">
                Dimensions: {metadata.dimensions.join(' × ')} voxels
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-500">No volume loaded</p>
        )}
      </div>
      
      {/* Conversion Tool */}
      <div className="grid grid-cols-2 gap-6">
        {/* Source */}
        <div className="p-4 bg-gray-800 rounded">
          <h3 className="text-sm font-medium text-gray-400 mb-3">From</h3>
          
          <select
            value={sourceSystem}
            onChange={(e) => setSourceSystem(e.target.value as CoordinateSystem)}
            className="w-full mb-4 px-3 py-2 bg-gray-700 text-white rounded text-sm"
          >
            {Object.entries(coordinateSystemLabels).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          
          <div className="space-y-2">
            {(['x', 'y', 'z'] as const).map(axis => (
              <div key={axis} className="flex items-center gap-2">
                <label className="text-xs text-gray-500 w-4">{axis.toUpperCase()}:</label>
                <input
                  type="number"
                  value={inputCoords[axis]}
                  onChange={(e) => handleInputChange(axis, e.target.value)}
                  className="flex-1 px-2 py-1 bg-gray-700 text-white rounded text-sm"
                  step={sourceSystem === 'voxel' ? '1' : '0.1'}
                />
              </div>
            ))}
          </div>
        </div>
        
        {/* Target */}
        <div className="p-4 bg-gray-800 rounded">
          <h3 className="text-sm font-medium text-gray-400 mb-3">To</h3>
          
          <select
            value={targetSystem}
            onChange={(e) => setTargetSystem(e.target.value as CoordinateSystem)}
            className="w-full mb-4 px-3 py-2 bg-gray-700 text-white rounded text-sm"
          >
            {Object.entries(coordinateSystemLabels).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          
          <div className="space-y-2">
            {(['x', 'y', 'z'] as const).map(axis => (
              <div key={axis} className="flex items-center gap-2">
                <label className="text-xs text-gray-500 w-4">{axis.toUpperCase()}:</label>
                <input
                  type="text"
                  value={outputCoords[axis].toFixed(targetSystem === 'voxel' ? 0 : 2)}
                  readOnly
                  className="flex-1 px-2 py-1 bg-gray-600 text-gray-300 rounded text-sm"
                />
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {/* Convert Button */}
      <div className="mt-6 flex justify-center">
        <button
          onClick={convertCoordinates}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm transition-colors"
        >
          Convert
        </button>
      </div>
      
      {/* Quick Actions */}
      <div className="mt-8 p-4 bg-gray-800 rounded">
        <h3 className="text-sm font-medium text-gray-400 mb-3">Quick Actions</h3>
        <div className="flex flex-wrap gap-2">
          <button className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded text-xs transition-colors">
            Copy Result
          </button>
          <button className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded text-xs transition-colors">
            Swap From/To
          </button>
          <button className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded text-xs transition-colors">
            Go to Crosshair
          </button>
        </div>
      </div>
      
      {/* Note */}
      <div className="mt-6 p-3 bg-yellow-900/20 border border-yellow-700/50 rounded text-xs text-yellow-300">
        <p className="font-medium mb-1">Demo Mode</p>
        <p>Conversions are simplified. In production, this would use proper affine transformations and atlas mappings.</p>
      </div>
    </div>
  );
}