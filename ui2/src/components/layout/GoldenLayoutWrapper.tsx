/**
 * Golden Layout React Wrapper
 * Provides React integration for Golden Layout v2
 */

import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { GoldenLayout, LayoutConfig, ComponentContainer } from 'golden-layout';
import { SliceView } from '@/components/views/SliceView';
import { OrthogonalViewContainer } from '@/components/views/OrthogonalViewContainer';
import { FlexibleSlicePanel } from '@/components/views/FlexibleSlicePanel';
import { FileBrowserPanel } from '@/components/panels/FileBrowserPanel';
import { LayerPanel } from '@/components/panels/LayerPanel';
import { useViewLayoutStore } from '@/stores/viewLayoutStore';
import { useResizeStore } from '@/stores/resizeStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { getApiService } from '@/services/apiService';
import 'golden-layout/dist/css/goldenlayout-base.css';
import 'golden-layout/dist/css/themes/goldenlayout-dark-theme.css';


function PlotPanel() {
  return (
    <div className="h-full bg-gray-900 text-gray-300 p-4">
      <h3 className="text-lg font-semibold text-blue-400 mb-2">Plot Panel</h3>
      <p className="text-sm">Time series plotting (Sprint 2)</p>
    </div>
  );
}

function ThreeDViewPanel() {
  return (
    <div className="h-full bg-gray-900 text-gray-300 p-4">
      <h3 className="text-lg font-semibold text-blue-400 mb-2">3D View</h3>
      <p className="text-sm">Three.js surface rendering (Sprint 2)</p>
    </div>
  );
}


// Locked layout configuration - single container
const lockedLayout: LayoutConfig = {
  root: {
    type: 'row',
    content: [
      {
        type: 'column',
        width: 15,
        content: [{
          type: 'component',
          componentType: 'FileBrowser',
          title: 'Files',
          componentState: {}
        }]
      },
      {
        type: 'component',
        componentType: 'OrthogonalView',
        title: 'Orthogonal Views',
        width: 65,
        componentState: {}
      },
      {
        type: 'column',
        width: 20,
        content: [
          {
            type: 'component',
            componentType: 'LayerPanel',
            title: 'Layers',
            height: 60,
            componentState: {}
          },
          {
            type: 'component',
            componentType: 'PlotPanel',
            title: 'Time Series',
            height: 40,
            componentState: {}
          }
        ]
      }
    ]
  }
};

// Flexible layout configuration - separate panels
const flexibleLayout: LayoutConfig = {
  root: {
    type: 'row',
    content: [
      {
        type: 'column',
        width: 15,
        content: [{
          type: 'component',
          componentType: 'FileBrowser',
          title: 'Files',
          componentState: {}
        }]
      },
      {
        type: 'column',
        width: 65,
        content: [
          {
            type: 'row',
            height: 50,
            content: [
              {
                type: 'component',
                componentType: 'AxialView',
                title: 'Axial',
                componentState: { viewId: 'axial' }
              }
            ]
          },
          {
            type: 'row',
            height: 50,
            content: [
              {
                type: 'component',
                componentType: 'SagittalView',
                title: 'Sagittal',
                width: 50,
                componentState: { viewId: 'sagittal' }
              },
              {
                type: 'component',
                componentType: 'CoronalView',
                title: 'Coronal',
                width: 50,
                componentState: { viewId: 'coronal' }
              }
            ]
          }
        ]
      },
      {
        type: 'column',
        width: 20,
        content: [
          {
            type: 'component',
            componentType: 'LayerPanel',
            title: 'Layers',
            height: 60,
            componentState: {}
          },
          {
            type: 'component',
            componentType: 'PlotPanel',
            title: 'Time Series',
            height: 40,
            componentState: {}
          }
        ]
      }
    ]
  }
};

// React component wrapper for Golden Layout components
function ReactComponentWrapper({ component, container, goldenContainer }: { 
  component: React.ComponentType<any>;
  container: ComponentContainer;
  goldenContainer: any; // Golden Layout DomContent
}) {
  const Component = component;
  const state = container.initialState || {};
  const [dimensions, setDimensions] = useState({ 
    width: goldenContainer.width || 512, 
    height: goldenContainer.height || 512 
  });
  
  // Listen to the Golden Layout container resize
  useEffect(() => {
    const handleResize = () => {
      const newWidth = goldenContainer.width;
      const newHeight = goldenContainer.height;
      console.log(`[ReactComponentWrapper] Golden Layout container resized: ${newWidth}x${newHeight}`);
      setDimensions({ width: newWidth, height: newHeight });
    };
    
    // Attach to Golden Layout's resize event
    goldenContainer.on('resize', handleResize);
    
    // Initial size
    handleResize();
    
    return () => {
      // Golden Layout v2 doesn't have off method, events are cleaned up on destroy
    };
  }, [goldenContainer]);
  
  // Pass the state and dimensions as props to the component
  return <Component {...state} containerWidth={dimensions.width} containerHeight={dimensions.height} />;
}

export function GoldenLayoutWrapper() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<GoldenLayout | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const { mode } = useViewLayoutStore();
  const resizeTimeoutRef = useRef<NodeJS.Timeout>();
  
  useEffect(() => {
    if (!containerRef.current) return;
    
    // Set transitioning state
    setIsTransitioning(true);
    
    // Clean up previous layout if exists
    setLayout(prevLayout => {
      if (prevLayout) {
        prevLayout.destroy();
      }
      return null;
    });
    
    const goldenLayout = new GoldenLayout(containerRef.current);
    
    // Component registry
    const componentRegistry = new Map<string, React.ComponentType<any>>();
    componentRegistry.set('SliceView', SliceView);
    componentRegistry.set('OrthogonalView', OrthogonalViewContainer);
    componentRegistry.set('FileBrowser', FileBrowserPanel);
    componentRegistry.set('LayerPanel', LayerPanel);
    componentRegistry.set('PlotPanel', PlotPanel);
    componentRegistry.set('ThreeDView', ThreeDViewPanel);
    
    // Register flexible view components
    componentRegistry.set('AxialView', FlexibleSlicePanel);
    componentRegistry.set('SagittalView', FlexibleSlicePanel);
    componentRegistry.set('CoronalView', FlexibleSlicePanel);
    
    // Register all components
    componentRegistry.forEach((component, name) => {
      goldenLayout.registerComponent(name, (container) => {
        const rootElement = document.createElement('div');
        rootElement.style.height = '100%';
        rootElement.style.width = '100%';
        container.element.appendChild(rootElement);
        
        const root = ReactDOM.createRoot(rootElement);
        
        // Create a ResizeObserver to detect actual DOM size changes
        const resizeObserver = new ResizeObserver((entries) => {
          for (const entry of entries) {
            console.log(`[GoldenLayout ResizeObserver] ${name} resized to ${entry.contentRect.width}x${entry.contentRect.height}`);
            // Trigger window resize for components listening
            window.dispatchEvent(new Event('resize'));
          }
        });
        
        // Start observing the container element
        resizeObserver.observe(container.element);
        
        root.render(
          <React.StrictMode>
            <ReactComponentWrapper 
              component={component} 
              container={container}
              goldenContainer={container}
            />
          </React.StrictMode>
        );
        
        // Listen for Golden Layout container resize events
        container.on('resize', () => {
          console.log(`[GoldenLayout] Container resize event for ${name} - width: ${container.width}, height: ${container.height}`);
          // Force React to re-render with new dimensions
          root.render(
            <React.StrictMode>
              <ReactComponentWrapper 
                component={component} 
                container={container}
                goldenContainer={container}
              />
            </React.StrictMode>
          );
        });
        
        // Listen for show events (when tab is selected)
        container.on('show', () => {
          console.log(`[GoldenLayout] Container show event for ${name}`);
          // Trigger resize when panel becomes visible
          window.dispatchEvent(new Event('resize'));
        });
        
        container.on('destroy', () => {
          // Clean up ResizeObserver
          resizeObserver.disconnect();
          // Schedule unmount asynchronously to avoid React race condition
          setTimeout(() => {
            root.unmount();
          }, 0);
        });
      });
    });
    
    // Load layout based on current mode
    const layoutConfig = mode === 'locked' ? lockedLayout : flexibleLayout;
    goldenLayout.loadLayout(layoutConfig);
    
    // Listen for layout state changes (including panel resizes)
    goldenLayout.on('stateChanged', () => {
      console.log('[GoldenLayout] State changed - likely due to panel resize');
      
      // Debounce render target updates
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      
      resizeTimeoutRef.current = setTimeout(async () => {
        // Get the overall container dimensions
        const containerWidth = containerRef.current!.offsetWidth;
        const containerHeight = containerRef.current!.offsetHeight;
        
        // Update render target if needed
        const resizeStore = useResizeStore.getState();
        const apiService = getApiService();
        
        try {
          resizeStore.startResize(containerWidth, containerHeight);
          await apiService.createOffscreenRenderTarget(containerWidth, containerHeight);
          resizeStore.completeResize();
          console.log('[GoldenLayout] Render target updated after resize');
          
          // Trigger a re-render by touching the ViewState
          // This ensures all views are redrawn with the new dimensions
          const viewStateStore = useViewStateStore.getState();
          viewStateStore.setViewState(state => state);
          console.log('[GoldenLayout] Triggered ViewState update to force re-render');
        } catch (error) {
          console.error('[GoldenLayout] Failed to update render target:', error);
          resizeStore.cancelResize();
        }
      }, 150); // Debounce by 150ms
    });
    
    setLayout(goldenLayout);
    setIsTransitioning(false);
    
    // Handle window resize
    const handleResize = () => {
      goldenLayout.updateSize(containerRef.current!.offsetWidth, containerRef.current!.offsetHeight);
    };
    window.addEventListener('resize', handleResize);
    
    return () => {
      window.removeEventListener('resize', handleResize);
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      // Don't destroy here as it's handled in the effect
    };
  }, [mode]); // Re-create layout when mode changes
  
  return (
    <div ref={containerRef} className="h-full w-full">
      {isTransitioning && (
        <div className="absolute inset-0 bg-gray-950 flex items-center justify-center z-50">
          <div className="text-gray-400 text-sm">Switching layout mode...</div>
        </div>
      )}
    </div>
  );
}

