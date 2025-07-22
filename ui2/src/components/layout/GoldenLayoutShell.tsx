/**
 * Golden Layout Shell - Early implementation for Sprint 1
 * This provides the basic layout structure while we build core components
 */

import React, { useEffect, useRef, useState } from 'react';
import { useBackendSync } from '@/hooks/useBackendSync';
import { useViewStateStore } from '@/stores/viewStateStore';
import { CoordinateTransform } from '@/utils/coordinates';
import { SliceView } from '@/components/views/SliceView';
import { CoordinateHeader } from '@/components/ui/CoordinateHeader';

// Enhanced placeholder that shows coordinate system working
const CoordinateTestPanel: React.FC = () => {
  const { viewState, setCrosshair } = useViewStateStore();
  const [mouseWorld, setMouseWorld] = useState<[number, number, number] | null>(null);
  
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Convert to world coordinates using axial plane
    const world = CoordinateTransform.screenToWorld(x, y, viewState.views.axial);
    setMouseWorld(world);
  };
  
  const handleClick = () => {
    if (mouseWorld) {
      setCrosshair(mouseWorld);
    }
  };
  
  return (
    <div className="h-full bg-gray-900 border border-gray-700 p-4">
      <h3 className="text-lg font-semibold text-blue-400 mb-2">Coordinate Test</h3>
      <div 
        className="bg-black border border-gray-600 h-48 relative cursor-crosshair"
        onMouseMove={handleMouseMove}
        onClick={handleClick}
      >
        {/* Crosshair visualization */}
        {viewState.crosshair.visible && (
          <div className="absolute inset-0 pointer-events-none">
            <div 
              className="absolute w-full border-t border-yellow-400"
              style={{ top: '50%' }}
            />
            <div 
              className="absolute h-full border-l border-yellow-400"
              style={{ left: '50%' }}
            />
          </div>
        )}
      </div>
      
      <div className="mt-2 text-xs space-y-1">
        <div className="text-gray-300">
          Mouse: {mouseWorld ? `[${mouseWorld.map(v => v.toFixed(1)).join(', ')}]` : 'N/A'}
        </div>
        <div className="text-yellow-400">
          Crosshair: [{viewState.crosshair.world_mm.map(v => v.toFixed(1)).join(', ')}]
        </div>
        <div className="text-gray-500">
          Click to update crosshair position
        </div>
      </div>
    </div>
  );
};

// Placeholder components for early development
const PlaceholderPanel: React.FC<{ title: string; description: string }> = ({ title, description }) => (
  <div className="h-full bg-gray-900 border border-gray-700 p-4">
    <h3 className="text-lg font-semibold text-blue-400 mb-2">{title}</h3>
    <p className="text-gray-300 text-sm">{description}</p>
    <div className="mt-4 text-xs text-gray-500">
      Component will be implemented in Sprint 2
    </div>
  </div>
);

const FileBrowserPlaceholder = () => (
  <PlaceholderPanel 
    title="File Browser" 
    description="Virtual scrolling file tree with lazy loading and search capabilities." 
  />
);


const LayerPanelPlaceholder = () => (
  <PlaceholderPanel 
    title="Layer Panel" 
    description="Layer stack with opacity, intensity, and colormap controls. Batched backend updates." 
  />
);

const PlotPanelPlaceholder = () => (
  <PlaceholderPanel 
    title="Plot Panel" 
    description="Time series and ROI value plotting with crosshair interaction." 
  />
);

// Slice view panel wrapper
const SliceViewPanel: React.FC<{ viewId: 'axial' | 'sagittal' | 'coronal' }> = ({ viewId }) => (
  <div className="h-full bg-gray-900 border border-gray-700 flex flex-col">
    <div className="bg-gray-800 px-3 py-2 border-b border-gray-700">
      <h3 className="text-sm font-medium text-blue-400">
        {viewId.charAt(0).toUpperCase() + viewId.slice(1)} View
      </h3>
    </div>
    <div className="flex-1 overflow-hidden">
      <SliceView 
        viewId={viewId} 
        width={256} 
        height={256}
        className="h-full"
      />
    </div>
  </div>
);

export const GoldenLayoutShell: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isReady, setIsReady] = useState(false);
  
  // Connect to backend sync system
  useBackendSync();

  useEffect(() => {
    if (!containerRef.current) return;

    // For Sprint 1, we'll use a simple CSS Grid layout
    // This provides the shell while we build the actual Golden Layout integration
    setIsReady(true);
  }, []);

  if (!isReady) {
    return (
      <div className="h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="text-2xl font-bold text-blue-400 mb-2">Brainflow2</div>
          <div className="text-gray-400">Loading React UI...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-950 flex flex-col">
      {/* Coordinate Header */}
      <CoordinateHeader />
      
      <div 
        ref={containerRef}
        className="flex-1 grid grid-cols-12 grid-rows-12 gap-1 p-1"
      >
        {/* File Browser - Left sidebar */}
        <div className="col-span-2 row-span-12">
          <FileBrowserPlaceholder />
        </div>
      
      {/* Orthogonal slice views - Main content area */}
      <div className="col-span-7 row-span-8 grid grid-cols-2 grid-rows-2 gap-1">
        {/* Axial view (top-left) */}
        <div className="col-span-1 row-span-1">
          <SliceViewPanel viewId="axial" />
        </div>
        
        {/* Sagittal view (top-right) */}
        <div className="col-span-1 row-span-1">
          <SliceViewPanel viewId="sagittal" />
        </div>
        
        {/* Coronal view (bottom-left) */}
        <div className="col-span-1 row-span-1">
          <SliceViewPanel viewId="coronal" />
        </div>
        
        {/* Coordinate test panel (bottom-right) */}
        <div className="col-span-1 row-span-1">
          <CoordinateTestPanel />
        </div>
      </div>
      
      {/* 3D view placeholder - Right side */}
      <div className="col-span-3 row-span-8">
        <PlaceholderPanel 
          title="3D View" 
          description="Three.js surface rendering with camera controls and lighting." 
        />
      </div>
      
      {/* Bottom panels */}
      <div className="col-span-5 row-span-4">
        <LayerPanelPlaceholder />
      </div>
      
      <div className="col-span-5 row-span-4">
        <PlotPanelPlaceholder />
      </div>
      
      {/* Status indicator */}
      <div className="fixed bottom-4 right-4 bg-green-600 text-white text-xs px-2 py-1 rounded">
        React UI Active
      </div>
      </div>
    </div>
  );
};