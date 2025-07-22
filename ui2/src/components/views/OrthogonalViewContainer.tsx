/**
 * OrthogonalViewContainer - Container for all three orthogonal slice views
 * Manages layout with Axial on top, Sagittal and Coronal on bottom
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { SliceView } from './SliceView';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useViewLayoutStore } from '@/stores/viewLayoutStore';
import { getFileLoadingService } from '@/services/FileLoadingService';
import { getApiService } from '@/services/apiService';
import { useResizeStore } from '@/stores/resizeStore';

interface OrthogonalViewContainerProps {
  className?: string;
  containerWidth?: number;
  containerHeight?: number;
}

export function OrthogonalViewContainer({ className = '', containerWidth, containerHeight }: OrthogonalViewContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 512, height: 512 });
  const [isDragging, setIsDragging] = useState(false);
  const apiService = getApiService();
  
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
  
  // Handle Golden Layout container dimensions if provided
  useEffect(() => {
    if (containerWidth && containerHeight) {
      console.log(`[OrthogonalViewContainer] Golden Layout dimensions received: ${containerWidth}x${containerHeight}`);
      // Trigger a resize with the Golden Layout dimensions
      const handleResize = async () => {
        const viewWidth = Math.floor(containerWidth / 2);
        const viewHeight = Math.floor(containerHeight / 2);
        
        setDimensions({ width: viewWidth, height: viewHeight });
        
        const resizeStore = useResizeStore.getState();
        resizeStore.startResize(containerWidth, containerHeight);
        
        try {
          await apiService.createOffscreenRenderTarget(containerWidth, containerHeight);
          
          const viewStateStore = useViewStateStore.getState();
          
          // Don't update view dimensions - let the backend maintain proper aspect ratios
          // The frontend will scale the rendered images to fit the containers
        } catch (error) {
          console.error('[OrthogonalViewContainer] Failed to handle Golden Layout resize:', error);
          resizeStore.cancelResize();
        }
      };
      
      handleResize();
    }
  }, [containerWidth, containerHeight, apiService]);
  
  // Update dimensions on resize
  useEffect(() => {
    let resizeTimeout: NodeJS.Timeout;
    const resizeStore = useResizeStore.getState();
    
    const updateRenderTarget = async (width: number, height: number) => {
      try {
        console.log(`[OrthogonalViewContainer] Updating render target: ${width}x${height}`);
        resizeStore.startResize(width, height);
        await apiService.createOffscreenRenderTarget(width, height);
        return true;
      } catch (error) {
        console.error('[OrthogonalViewContainer] Failed to update render target:', error);
        resizeStore.cancelResize();
        return false;
      }
    };
    
    // Remove view dimension updates - the backend maintains proper aspect ratios
    
    const handleResize = async () => {
      if (!containerRef.current) return;
      
      const rect = containerRef.current.getBoundingClientRect();
      const viewWidth = Math.floor(rect.width / 2);
      const viewHeight = Math.floor(rect.height / 2);
      
      // Update local state immediately
      setDimensions({ width: viewWidth, height: viewHeight });
      
      // Update render target immediately (no debounce)
      const renderTargetUpdated = await updateRenderTarget(
        Math.floor(rect.width),
        Math.floor(rect.height)
      );
      
      // No need to update view dimensions anymore
    };
    
    // Debounced version for rapid resize events
    const debouncedHandleResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(handleResize, 50); // Shorter debounce for responsiveness
    };
    
    // Initial dimensions setup
    handleResize();
    
    // Use immediate handler for window resize (Golden Layout triggers this)
    window.addEventListener('resize', handleResize);
    
    // ResizeObserver for more accurate container resize detection
    // Use immediate callback for better responsiveness
    const resizeObserver = new ResizeObserver(() => {
      console.log('[OrthogonalViewContainer] ResizeObserver triggered');
      handleResize();
    });
    
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }
    
    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      clearTimeout(resizeTimeout);
    };
  }, [apiService]);
  
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
        <div className="w-full h-full">
          <SliceView
            viewId="axial"
            width={dimensions.width * 2} // Full width
            height={dimensions.height}
            className="h-full w-full"
          />
        </div>
        
        {/* Bottom row: Sagittal and Coronal views */}
        <div className="grid grid-cols-2 gap-1 h-full">
          <div className="w-full h-full">
            <SliceView
              viewId="sagittal"
              width={dimensions.width}
              height={dimensions.height}
              className="h-full w-full"
            />
          </div>
          <div className="w-full h-full">
            <SliceView
              viewId="coronal"
              width={dimensions.width}
              height={dimensions.height}
              className="h-full w-full"
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