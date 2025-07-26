/**
 * ROIStatsWorkspace Component
 * Simple ROI statistics analysis workspace
 */

import React, { useState, useEffect } from 'react';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';

interface ROIStatsWorkspaceProps {
  containerWidth?: number;
  containerHeight?: number;
}

export function ROIStatsWorkspace({ containerWidth = 800, containerHeight = 600 }: ROIStatsWorkspaceProps) {
  const layers = useLayerStore(state => state.layers);
  const layerMetadata = useLayerStore(state => state.layerMetadata);
  const viewState = useViewStateStore(state => state.viewState);
  const [selectedRadius, setSelectedRadius] = useState(5); // mm
  const [stats, setStats] = useState<{mean: number; std: number; min: number; max: number; voxelCount: number} | null>(null);
  
  // Get current crosshair position
  const crosshair = viewState.crosshair.world_mm;
  
  // Calculate stats when crosshair or radius changes
  useEffect(() => {
    // For now, just generate some dummy stats
    // In a real implementation, this would query the backend for voxel values
    const dummyStats = {
      mean: 102.5 + Math.random() * 20,
      std: 15.2 + Math.random() * 5,
      min: 80 + Math.random() * 10,
      max: 140 + Math.random() * 20,
      voxelCount: Math.floor(4/3 * Math.PI * Math.pow(selectedRadius, 3) / 8) // Approximate voxel count
    };
    
    setStats(dummyStats);
  }, [crosshair, selectedRadius]);
  
  // Get active layer info
  const activeLayer = layers.find(l => l.visible);
  const metadata = activeLayer ? layerMetadata.get(activeLayer.id) : undefined;
  
  return (
    <div className="h-full bg-gray-900 text-gray-100 p-6 overflow-auto">
      <h2 className="text-xl font-semibold mb-6">ROI Statistics</h2>
      
      {/* Layer Info */}
      <div className="mb-6 p-4 bg-gray-800 rounded">
        <h3 className="text-sm font-medium text-gray-400 mb-2">Active Layer</h3>
        {activeLayer ? (
          <div>
            <p className="text-sm">{activeLayer.name}</p>
            <p className="text-xs text-gray-500">
              {metadata?.dimensions ? `${metadata.dimensions.join(' × ')} voxels` : ''}
            </p>
          </div>
        ) : (
          <p className="text-sm text-gray-500">No active layer</p>
        )}
      </div>
      
      {/* ROI Configuration */}
      <div className="mb-6 p-4 bg-gray-800 rounded">
        <h3 className="text-sm font-medium text-gray-400 mb-2">ROI Configuration</h3>
        
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500">Center (World mm)</label>
            <p className="text-sm font-mono">
              ({crosshair[0].toFixed(1)}, {crosshair[1].toFixed(1)}, {crosshair[2].toFixed(1)})
            </p>
          </div>
          
          <div>
            <label className="text-xs text-gray-500 block mb-1">Radius (mm)</label>
            <input
              type="range"
              min="1"
              max="20"
              step="0.5"
              value={selectedRadius}
              onChange={(e) => setSelectedRadius(parseFloat(e.target.value))}
              className="w-full"
            />
            <span className="text-sm">{selectedRadius} mm</span>
          </div>
        </div>
      </div>
      
      {/* Statistics */}
      {stats && (
        <div className="mb-6 p-4 bg-gray-800 rounded">
          <h3 className="text-sm font-medium text-gray-400 mb-3">Statistics</h3>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-500">Mean</p>
              <p className="text-lg font-semibold">{stats.mean.toFixed(2)}</p>
            </div>
            
            <div>
              <p className="text-xs text-gray-500">Std Dev</p>
              <p className="text-lg font-semibold">{stats.std.toFixed(2)}</p>
            </div>
            
            <div>
              <p className="text-xs text-gray-500">Min</p>
              <p className="text-lg font-semibold">{stats.min.toFixed(2)}</p>
            </div>
            
            <div>
              <p className="text-xs text-gray-500">Max</p>
              <p className="text-lg font-semibold">{stats.max.toFixed(2)}</p>
            </div>
            
            <div className="col-span-2">
              <p className="text-xs text-gray-500">Voxel Count</p>
              <p className="text-lg font-semibold">{stats.voxelCount}</p>
            </div>
          </div>
        </div>
      )}
      
      {/* Actions */}
      <div className="flex gap-2">
        <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm transition-colors">
          Export Stats
        </button>
        <button className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm transition-colors">
          Save ROI
        </button>
      </div>
      
      {/* Note */}
      <div className="mt-6 p-3 bg-yellow-900/20 border border-yellow-700/50 rounded text-xs text-yellow-300">
        <p className="font-medium mb-1">Demo Mode</p>
        <p>Statistics are simulated. In production, this would query actual voxel values from the backend.</p>
      </div>
    </div>
  );
}