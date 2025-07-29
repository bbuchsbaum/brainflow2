/**
 * OrthogonalViewContainer - Container for all three orthogonal slice views
 * Manages layout with Axial on top, Sagittal and Coronal on bottom
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { FlexibleSlicePanel } from './FlexibleSlicePanel';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useViewLayoutStore } from '@/stores/viewLayoutStore';
import { getFileLoadingService } from '@/services/FileLoadingService';

interface OrthogonalViewContainerProps {
  className?: string;
  containerWidth?: number;
  containerHeight?: number;
}

export function OrthogonalViewContainer({ className = '', containerWidth, containerHeight }: OrthogonalViewContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  
  // View layout state
  const { mode, toggleMode, isLocked } = useViewLayoutStore();
  
  // Keyboard shortcut handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + L to toggle layout mode
      if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
        e.preventDefault();
        toggleMode();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleMode]);
  
  // Log Golden Layout dimensions (FlexibleSlicePanel will handle its own sizing)
  useEffect(() => {
    if (containerWidth && containerHeight) {
      console.log(`[OrthogonalViewContainer] Golden Layout dimensions received: ${containerWidth}x${containerHeight} - FlexibleSlicePanel components will handle individual sizing`);
    }
  }, [containerWidth, containerHeight]);
  
  // Handle file drop at container level
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);
  
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Only set dragging to false if we're leaving the container entirely
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      const x = e.clientX;
      const y = e.clientY;
      if (x <= rect.left || x >= rect.right || y <= rect.top || y >= rect.bottom) {
        setIsDragging(false);
      }
    }
  }, []);
  
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files);
    const validExtensions = ['.nii', '.nii.gz', '.gii'];
    
    const fileLoadingService = getFileLoadingService();
    
    for (const file of files) {
      const hasValidExtension = validExtensions.some(ext => 
        file.name.toLowerCase().endsWith(ext)
      );
      
      if (hasValidExtension) {
        // Use the loadDroppedFile method which handles Tauri file paths
        await fileLoadingService.loadDroppedFile(file);
      }
    }
  }, []);
  
  return (
    <div 
      ref={containerRef}
      className={`orthogonal-view-container ${className} h-full w-full relative bg-gray-900`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Toggle button - minimal design */}
      <button
        className="absolute top-3 right-3 z-20 p-2
                   bg-gray-800/60 hover:bg-gray-700/60 
                   text-gray-300 hover:text-white
                   rounded border border-gray-700/50
                   transition-all duration-150"
        onClick={toggleMode}
        title={isLocked() ? "Unlock views for flexible layout (⌘L)" : "Lock views together (⌘L)"}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          {isLocked() ? (
            // Lock icon
            <>
              <rect x="5" y="11" width="14" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </>
          ) : (
            // Unlock icon
            <>
              <rect x="5" y="11" width="14" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0110 0" />
            </>
          )}
        </svg>
      </button>
      
      {/* Layout: Axial on top, Sagittal and Coronal on bottom */}
      <div className="grid grid-rows-2 h-full gap-1 p-1">
        {/* Top row: Axial view */}
        <div className="w-full h-full overflow-visible">
          <FlexibleSlicePanel
            viewId="axial"
            title="Axial"
          />
        </div>
        
        {/* Bottom row: Sagittal and Coronal views */}
        <div className="grid grid-cols-2 gap-1 h-full">
          <div className="w-full h-full">
            <FlexibleSlicePanel
              viewId="sagittal"
              title="Sagittal"
            />
          </div>
          <div className="w-full h-full">
            <FlexibleSlicePanel
              viewId="coronal"
              title="Coronal"
            />
          </div>
        </div>
      </div>
      
      {/* Container-level drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 bg-blue-500 bg-opacity-10 pointer-events-none flex items-center justify-center z-50">
          <div className="bg-white rounded-lg px-6 py-4 shadow-2xl">
            <div className="text-blue-600 font-semibold text-lg">Drop neuroimaging files to load</div>
            <div className="text-gray-500 text-sm mt-1">Supported: .nii, .nii.gz, .gii</div>
          </div>
        </div>
      )}
    </div>
  );
}