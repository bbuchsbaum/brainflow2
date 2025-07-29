/**
 * Golden Layout React Wrapper
 * Provides React integration for Golden Layout v2
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { GoldenLayout, LayoutConfig, ComponentContainer } from 'golden-layout';
import { SliceView } from '@/components/views/SliceView';
import { OrthogonalViewContainer } from '@/components/views/OrthogonalViewContainer';
import { FlexibleSlicePanel } from '@/components/views/FlexibleSlicePanel';
import { FileBrowserPanel } from '@/components/panels/FileBrowserPanel';
import { LayerPanel } from '@/components/panels/LayerPanel';
import { useViewLayoutStore } from '@/stores/viewLayoutStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { getRenderCoordinator } from '@/services/RenderCoordinator';
import 'golden-layout/dist/css/goldenlayout-base.css';
import 'golden-layout/dist/css/themes/goldenlayout-dark-theme.css';

interface GoldenLayoutWrapperProps {
  layoutConfig?: LayoutConfig;
  onLayoutChange?: (config: LayoutConfig) => void;
  onPanelClose?: (panelId: string) => void;
  onPanelOpen?: (panelId: string) => void;
}


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
            type: 'component',
            componentType: 'AxialView',
            title: 'Axial',
            height: 50,
            componentState: { viewId: 'axial' }
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

// Validate dimension helper function - defined outside component for stability
const validateDimension = (value: any, defaultValue: number = 512): number => {
  const num = Number(value);
  // Increased limit to handle 4K/5K displays and prevent validation failures
  if (!isNaN(num) && num > 0 && num <= 16384) {
    return Math.floor(num);
  }
  console.warn(`[ReactComponentWrapper] Invalid dimension value: ${value}, using default: ${defaultValue}`);
  return defaultValue;
};

// Sanitize layout config to ensure all values are the correct type
const sanitizeLayoutConfig = (config: any): any => {
  if (!config) return config;
  
  if (typeof config === 'object' && config !== null) {
    const sanitized: any = Array.isArray(config) ? [] : {};
    
    for (const key in config) {
      const value = config[key];
      
      // Ensure title is always a string
      if (key === 'title' && value != null) {
        sanitized[key] = String(value);
      }
      // Ensure componentType is always a string
      else if (key === 'componentType' && value != null) {
        sanitized[key] = String(value);
      }
      // Ensure type is always a string
      else if (key === 'type' && value != null) {
        sanitized[key] = String(value);
      }
      // Handle size property - convert numbers to strings with units
      else if (key === 'size' && typeof value === 'number') {
        // Convert numeric size to string with % unit
        sanitized[key] = `${value}%`;
      }
      // Handle minSize property - convert numbers to strings with units
      else if (key === 'minSize' && typeof value === 'number') {
        // Convert numeric minSize to string with px unit
        sanitized[key] = `${value}px`;
      }
      // Handle dimension properties that should be strings with px units
      else if ((key === 'defaultMinItemHeight' || key === 'defaultMinItemWidth') && typeof value === 'number') {
        sanitized[key] = `${value}px`;
      }
      // Ensure width and height remain as numbers
      else if ((key === 'width' || key === 'height') && value != null) {
        sanitized[key] = Number(value);
      }
      // Special handling for dimensions object
      else if (key === 'dimensions' && typeof value === 'object' && value !== null) {
        sanitized[key] = {};
        for (const dimKey in value) {
          const dimValue = value[dimKey];
          // Convert numeric dimension values to strings with px
          if ((dimKey === 'defaultMinItemHeight' || dimKey === 'defaultMinItemWidth') && typeof dimValue === 'number') {
            sanitized[key][dimKey] = `${dimValue}px`;
          } else {
            sanitized[key][dimKey] = dimValue;
          }
        }
      }
      // Recursively sanitize nested objects
      else if (typeof value === 'object' && value !== null) {
        sanitized[key] = sanitizeLayoutConfig(value);
      }
      else {
        sanitized[key] = value;
      }
    }
    
    return sanitized;
  }
  
  return config;
};

// React component wrapper for Golden Layout components
function ReactComponentWrapper({ component, container, goldenContainer }: { 
  component: React.ComponentType<any>;
  container: ComponentContainer;
  goldenContainer: any; // Golden Layout DomContent
}) {
  const Component = component;
  const state = container.initialState || {};
  
  // Render loop detection
  const renderCount = useRef(0);
  renderCount.current++;
  if (renderCount.current > 50) {
    console.error(`[ReactComponentWrapper ${Component.name}] RENDER LOOP DETECTED! Render count:`, renderCount.current);
    console.trace('Stack trace:');
  }
  
  // Log initial dimensions for debugging
  const initialWidth = goldenContainer.width;
  const initialHeight = goldenContainer.height;
  
  if (initialHeight > 2000) {
    console.error(`[ReactComponentWrapper ${Component.name}] EXTREME HEIGHT DETECTED!`, {
      width: initialWidth,
      height: initialHeight,
      element: goldenContainer.element,
      parent: goldenContainer.element?.parentElement,
      parentHeight: goldenContainer.element?.parentElement?.offsetHeight
    });
    console.trace('Stack trace for extreme height:');
  }
  
  const [dimensions, setDimensions] = useState(() => ({ 
    width: validateDimension(initialWidth), 
    height: validateDimension(initialHeight) 
  }));
  
  // Store goldenContainer ref to avoid closure issues
  const containerRef = useRef(goldenContainer);
  containerRef.current = goldenContainer;
  
  // Listen to the Golden Layout container resize
  useEffect(() => {
    console.log('[ReactComponentWrapper] Setting up resize listener');
    
    const container = containerRef.current;
    
    // Check if container is valid
    if (!container || typeof container.on !== 'function') {
      console.warn('[ReactComponentWrapper] Invalid container, skipping resize listener');
      return;
    }
    
    // Log initial dimensions
    console.log(`[ReactComponentWrapper ${Component.name}] Initial container dimensions:`, {
      width: container.width,
      height: container.height,
      element: container.element,
      parentHeight: container.element?.parentElement?.offsetHeight
    });
    
    const handleResize = () => {
      const currentContainer = containerRef.current;
      if (!currentContainer) return;
      
      // Check for extreme dimensions before validation
      if (currentContainer.height > 2000) {
        console.error(`[ReactComponentWrapper] Extreme height in resize event!`, {
          width: currentContainer.width,
          height: currentContainer.height,
          element: currentContainer.element,
          parent: currentContainer.element?.parentElement,
          parentHeight: currentContainer.element?.parentElement?.offsetHeight,
          componentName: Component.name
        });
      }
      
      const newWidth = validateDimension(currentContainer.width);
      const newHeight = validateDimension(currentContainer.height);
      console.log(`[ReactComponentWrapper] Golden Layout container resized: ${newWidth}x${newHeight} (raw: ${currentContainer.width}x${currentContainer.height})`);
      setDimensions(prevDimensions => {
        // Only update if dimensions actually changed
        if (prevDimensions.width !== newWidth || prevDimensions.height !== newHeight) {
          return { width: newWidth, height: newHeight };
        }
        return prevDimensions;
      });
    };
    
    // Attach to Golden Layout's resize event
    container.on('resize', handleResize);
    
    // Check initial size only if different from state
    const currentWidth = validateDimension(container.width);
    const currentHeight = validateDimension(container.height);
    
    // Debug: Log parent container info
    if (container.element && container.element.parentElement) {
      const parent = container.element.parentElement;
      console.log(`[ReactComponentWrapper ${Component.name}] Parent container info:`, {
        parentHeight: parent.offsetHeight,
        parentClass: parent.className,
        computedStyle: window.getComputedStyle(parent).height
      });
    }
    
    setDimensions(prevDimensions => {
      // Only update if actually different from current state
      if (prevDimensions.width !== currentWidth || prevDimensions.height !== currentHeight) {
        console.log(`[ReactComponentWrapper] Initial size update: ${currentWidth}x${currentHeight}`);
        return { width: currentWidth, height: currentHeight };
      }
      return prevDimensions;
    });
    
    // Cleanup function
    return () => {
      // Golden Layout v2 might not have off method, but try to clean up if possible
      if (container && typeof container.off === 'function') {
        container.off('resize', handleResize);
      }
    };
  }, []); // Empty dependency array - only run once
  
  // Pass the state and dimensions as props to the component
  // Final safety check - clamp dimensions to reasonable values
  const safeWidth = Math.min(dimensions.width, 2048);
  const safeHeight = Math.min(dimensions.height, 2048);
  
  if (safeWidth !== dimensions.width || safeHeight !== dimensions.height) {
    console.warn(`[ReactComponentWrapper] Clamping dimensions for ${Component.name}: ${dimensions.width}x${dimensions.height} -> ${safeWidth}x${safeHeight}`);
  }
  
  return <Component {...state} containerWidth={safeWidth} containerHeight={safeHeight} />;
}

export function GoldenLayoutWrapper({ 
  layoutConfig, 
  onLayoutChange, 
  onPanelClose, 
  onPanelOpen 
}: GoldenLayoutWrapperProps) {
  // All hooks must be called before any conditional returns
  const containerRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<GoldenLayout | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const { mode } = useViewLayoutStore();
  const resizeTimeoutRef = useRef<NodeJS.Timeout>();
  const retryCountRef = useRef(0);
  const renderCount = useRef(0);
  const lastConfigRef = useRef<LayoutConfig | undefined>();
  
  // Render loop detection and bailout (after all hooks)
  renderCount.current++;
  if (renderCount.current > 50) {
    console.error('[GoldenLayoutWrapper] RENDER LOOP DETECTED! Render count:', renderCount.current);
    console.trace('Stack trace:');
    // Bail out to prevent browser crash
    if (renderCount.current > 100) {
      return (
        <div className="h-full w-full flex items-center justify-center text-red-500">
          <div className="text-center">
            <p className="mb-4">Render loop detected in GoldenLayoutWrapper</p>
            <p>Please refresh the page</p>
          </div>
        </div>
      );
    }
  }
  
  useEffect(() => {
    if (!containerRef.current || layoutRef.current) return;
    
    // Wait for container to have dimensions
    const checkDimensions = () => {
      if (!containerRef.current) return false;
      
      const containerWidth = containerRef.current.offsetWidth;
      const containerHeight = containerRef.current.offsetHeight;
      
      if (containerWidth <= 0 || containerHeight <= 0) {
        retryCountRef.current++;
        if (retryCountRef.current > 50) {
          console.error('[GoldenLayoutWrapper] Failed to get container dimensions after 50 retries');
          // Force initialize with default dimensions to prevent infinite waiting
          return true;
        }
        console.warn(`[GoldenLayoutWrapper] Container has no dimensions yet (retry ${retryCountRef.current}), waiting...`);
        // Schedule another check
        setTimeout(checkDimensions, 100);
        return false;
      }
      
      return true;
    };
    
    if (!checkDimensions()) {
      return;
    }
    
    const containerWidth = containerRef.current.offsetWidth;
    const containerHeight = containerRef.current.offsetHeight;
    
    console.log(`[GoldenLayoutWrapper] Initializing with container dimensions: ${containerWidth}x${containerHeight}`);
    
    // Set transitioning state
    setIsTransitioning(true);
    
    const goldenLayout = new GoldenLayout(containerRef.current);
    
    // Override dimension calculation to prevent extreme values
    const originalUpdateSize = goldenLayout.updateSize.bind(goldenLayout);
    goldenLayout.updateSize = function(width?: number, height?: number) {
      const clampedWidth = width && width > 0 ? Math.min(width, 2048) : undefined;
      const clampedHeight = height && height > 0 ? Math.min(height, 2048) : undefined;
      
      if (width && width > 2048) {
        console.warn(`[GoldenLayout] Clamping extreme width: ${width} -> ${clampedWidth}`);
      }
      if (height && height > 2048) {
        console.warn(`[GoldenLayout] Clamping extreme height: ${height} -> ${clampedHeight}`);
      }
      
      return originalUpdateSize(clampedWidth, clampedHeight);
    };
    
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
    
    // Register empty view as fallback
    componentRegistry.set('EmptyView', () => (
      <div className="h-full flex items-center justify-center text-gray-500">
        <p>Failed to load layout</p>
      </div>
    ));
    
    // Import and register additional components dynamically
    import('@/components/views/MosaicViewSimple').then(module => {
      componentRegistry.set('MosaicView', module.MosaicViewSimple);
    });
    
    import('@/components/analysis/ROIStatsWorkspace').then(module => {
      componentRegistry.set('ROIStatsWorkspace', module.ROIStatsWorkspace);
    });
    
    import('@/components/tools/CoordinateConverterWorkspace').then(module => {
      componentRegistry.set('CoordinateConverterWorkspace', module.CoordinateConverterWorkspace);
    });
    
    import('@/components/views/LightboxView').then(module => {
      componentRegistry.set('LightboxView', module.LightboxView);
    });
    
    // Register all components
    componentRegistry.forEach((component, name) => {
      goldenLayout.registerComponent(name, (container) => {
        const rootElement = document.createElement('div');
        rootElement.style.height = '100%';
        rootElement.style.width = '100%';
        container.element.appendChild(rootElement);
        
        const root = ReactDOM.createRoot(rootElement);
        
        // NOTE: ResizeObserver removed to prevent feedback loops
        // The ReactComponentWrapper already handles resize events from GoldenLayout
        
        root.render(
          <React.StrictMode>
            <ReactComponentWrapper 
              component={component} 
              container={container}
              goldenContainer={container}
            />
          </React.StrictMode>
        );
        
        // Note: We don't need a container resize listener here because
        // ReactComponentWrapper already handles resize events internally.
        // Having both would cause duplicate handling and potential loops.
        
        // Listen for show events (when tab is selected)
        container.on('show', () => {
          console.log(`[GoldenLayout] Container show event for ${name}`);
          // Trigger resize when panel becomes visible
          window.dispatchEvent(new Event('resize'));
        });
        
        container.on('destroy', () => {
          
          // Notify about panel close if this is a panel with an ID
          const componentState = container.initialState;
          if (onPanelClose && componentState?.viewId) {
            onPanelClose(componentState.viewId);
          }
          
          // Schedule unmount asynchronously to avoid React race condition
          setTimeout(() => {
            root.unmount();
          }, 0);
        });
      });
    });
    
    // Load layout - use provided config or fall back to mode-based layout
    const configToLoad = layoutConfig || (mode === 'locked' ? lockedLayout : flexibleLayout);
    const sanitizedConfig = sanitizeLayoutConfig(configToLoad);
    
    console.log('[GoldenLayoutWrapper] Loading layout with sanitized config:', JSON.stringify(sanitizedConfig, null, 2));
    
    try {
      goldenLayout.loadLayout(sanitizedConfig);
    } catch (error) {
      console.error('[GoldenLayoutWrapper] Failed to load layout:', error);
      console.error('[GoldenLayoutWrapper] Config that caused error:', sanitizedConfig);
      
      // Try to load a minimal fallback layout
      const fallbackLayout = {
        root: {
          type: 'component',
          componentType: 'EmptyView',
          title: 'Error Loading Layout',
          componentState: {}
        }
      };
      
      try {
        goldenLayout.loadLayout(fallbackLayout);
      } catch (fallbackError) {
        console.error('[GoldenLayoutWrapper] Failed to load fallback layout:', fallbackError);
      }
    }
    
    // Listen for layout state changes (including panel resizes)
    goldenLayout.on('stateChanged', () => {
      console.log('[GoldenLayout] State changed - likely due to panel resize');
      
      // Debug: Check all component containers for extreme dimensions
      const rootComponent = goldenLayout.rootComponent;
      if (rootComponent) {
        const checkComponentDimensions = (component: any, path: string) => {
          if (component.width > 2000 || component.height > 2000) {
            console.error(`[GoldenLayout] Extreme dimensions found at ${path}:`, {
              width: component.width,
              height: component.height,
              type: component.type,
              componentType: component.componentType
            });
          }
          if (component.contentItems) {
            component.contentItems.forEach((item: any, index: number) => {
              checkComponentDimensions(item, `${path}[${index}]`);
            });
          }
        };
        checkComponentDimensions(rootComponent, 'root');
      }
      
      // Call the layout change callback if provided
      if (onLayoutChange) {
        const currentConfig = goldenLayout.saveLayout();
        const sanitizedCurrentConfig = sanitizeLayoutConfig(currentConfig);
        onLayoutChange(sanitizedCurrentConfig);
      }
      
      // Debounce render target updates
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      
      resizeTimeoutRef.current = setTimeout(async () => {
        // Get the overall container dimensions
        const containerWidth = containerRef.current?.offsetWidth || 0;
        const containerHeight = containerRef.current?.offsetHeight || 0;
        
        console.log('[GoldenLayout] Container element:', {
          element: containerRef.current,
          offsetWidth: containerRef.current?.offsetWidth,
          offsetHeight: containerRef.current?.offsetHeight,
          clientWidth: containerRef.current?.clientWidth,
          clientHeight: containerRef.current?.clientHeight,
          boundingRect: containerRef.current?.getBoundingClientRect()
        });
        
        // Validate dimensions are reasonable
        if (containerWidth <= 0 || containerHeight <= 0 || 
            containerWidth > 8192 || containerHeight > 8192) {
          console.warn('[GoldenLayout] Invalid container dimensions:', containerWidth, 'x', containerHeight);
          return;
        }
        
        // Update render target using RenderCoordinator
        const renderCoordinator = getRenderCoordinator();
        
        try {
          await renderCoordinator.updateDimensions(containerWidth, containerHeight, 'resize');
          console.log('[GoldenLayout] Render target updated after resize');
          
          // Trigger a re-render by touching the ViewState
          // This ensures all views are redrawn with the new dimensions
          const viewStateStore = useViewStateStore.getState();
          viewStateStore.setViewState(state => state);
          console.log('[GoldenLayout] Triggered ViewState update to force re-render');
        } catch (error) {
          console.error('[GoldenLayout] Failed to update render target:', error);
        }
      }, 150); // Debounce by 150ms
    });
    
    // Store layout reference
    layoutRef.current = goldenLayout;
    lastConfigRef.current = layoutConfig;
    setIsTransitioning(false);
    setIsInitialized(true);
    
    return () => {
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      if (layoutRef.current) {
        layoutRef.current.destroy();
        layoutRef.current = null;
      }
    };
  }, []); // Empty dependency array - only create once
  
  // Handle window resize in a separate effect with RAF
  useLayoutEffect(() => {
    if (!layoutRef.current || !containerRef.current) return;
    
    let rafId: number;
    const handleResize = () => {
      // Cancel any pending RAF
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      
      // Schedule resize on next animation frame
      rafId = requestAnimationFrame(() => {
        if (layoutRef.current && containerRef.current) {
          layoutRef.current.updateSize(
            containerRef.current.offsetWidth,
            containerRef.current.offsetHeight
          );
        }
      });
    };
    
    window.addEventListener('resize', handleResize);
    
    return () => {
      window.removeEventListener('resize', handleResize);
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };
  }, []);
  
  // Handle layout config updates without recreating GoldenLayout
  useEffect(() => {
    if (!layoutRef.current || !layoutConfig || !isInitialized) return;
    
    // Check if config actually changed
    if (JSON.stringify(lastConfigRef.current) === JSON.stringify(layoutConfig)) {
      return;
    }
    
    console.log('[GoldenLayoutWrapper] Layout config changed, updating layout');
    lastConfigRef.current = layoutConfig;
    
    // Instead of recreating, we could update the existing layout
    // For now, we'll just log this - the layout changes should be handled by user interactions
    // not by prop changes
  }, [layoutConfig, isInitialized]);
  
  return (
    <div ref={containerRef} className="h-full w-full" style={{ minHeight: '400px', minWidth: '600px' }}>
      {isTransitioning && (
        <div className="absolute inset-0 bg-gray-950 flex items-center justify-center z-50">
          <div className="text-gray-400 text-sm">Switching layout mode...</div>
        </div>
      )}
      {!isInitialized && !isTransitioning && (
        <div className="h-full w-full flex items-center justify-center text-gray-500">
          <div className="text-sm">Initializing layout...</div>
        </div>
      )}
    </div>
  );
}

