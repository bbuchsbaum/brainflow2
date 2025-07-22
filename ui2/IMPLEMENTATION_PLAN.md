# Brainflow2 React UI Implementation Plan

## Executive Summary

This plan outlines the implementation of a new React-based frontend for Brainflow2, addressing fundamental architectural issues in the current Svelte implementation. The new architecture emphasizes simplicity, modularity, and performance through a clean unidirectional data flow and clear separation of concerns.

## Critical Architectural Principle: Coordinate System Ownership

### Frontend Owns the View Transform
The frontend maintains a complete understanding of the coordinate space to enable pixel-perfect annotation rendering:

```typescript
interface ViewPlane {
  // World space origin (mm) - upper-left corner of view
  origin_mm: [number, number, number];
  
  // World space vectors (mm per pixel)
  u_mm: [number, number, number];  // Right direction
  v_mm: [number, number, number];  // Down direction
  
  // Canvas dimensions
  dim_px: [number, number];
}

// Frontend can transform between coordinate systems
class CoordinateTransform {
  // Screen pixel to world space (for mouse clicks)
  screenToWorld(x: number, y: number, plane: ViewPlane): [number, number, number] {
    return [
      plane.origin_mm[0] + x * plane.u_mm[0] + y * plane.v_mm[0],
      plane.origin_mm[1] + x * plane.u_mm[1] + y * plane.v_mm[1],
      plane.origin_mm[2] + x * plane.u_mm[2] + y * plane.v_mm[2]
    ];
  }
  
  // World space to screen pixel (for annotation rendering)
  worldToScreen(world: [number, number, number], plane: ViewPlane): [number, number] | null {
    // Project world point onto plane and return pixel coordinates
    // Returns null if point is not on the plane
  }
}
```

### Seamless Annotation Overlay
```tsx
function SliceView({ plane }: { plane: ViewPlane }) {
  // Backend renders the volume slice
  const sliceImage = useSliceImage(plane);
  
  // Frontend renders annotations on top
  const annotations = useAnnotations();
  const transform = useCoordinateTransform();
  
  return (
    <div className="relative">
      {/* Backend-rendered slice */}
      <canvas ref={imageCanvas} />
      
      {/* Frontend annotation overlay */}
      <svg className="absolute inset-0">
        {/* Crosshair */}
        {crosshair.visible && (
          <Crosshair 
            position={transform.worldToScreen(crosshair.world_mm, plane)}
          />
        )}
        
        {/* Markers */}
        {annotations.map(marker => {
          const screenPos = transform.worldToScreen(marker.world_mm, plane);
          return screenPos && <Marker key={marker.id} position={screenPos} />;
        })}
      </svg>
    </div>
  );
}
```

## Why React Architecture is Superior

### 1. **Single Source of Truth**
- **Current**: Multiple interconnected Svelte stores with circular dependencies
- **New**: One `ViewState` object that triggers all renders
- **Benefit**: Predictable state updates, no race conditions

### 2. **Simplified Data Flow**
```
User Action → Service → Store → Backend → UI
```
- **Current**: Complex cascading updates between stores
- **New**: Unidirectional flow with coalesced updates
- **Benefit**: 90% fewer backend calls, easier debugging

### 3. **Clean Component Architecture**
- **Current**: Business logic mixed with UI code
- **New**: Thin UI components, logic in services
- **Benefit**: Testable, reusable components

### 4. **Performance Through Simplicity**
- **Current**: Every UI change triggers multiple backend calls
- **New**: Coalesced updates via `requestAnimationFrame`
- **Benefit**: Smooth 60fps interaction, no IPC bottlenecks

### 5. **Precise Coordinate System Control**
- **Current**: Confused coordinate handling between frontend/backend
- **New**: Frontend owns view transform, backend is pure renderer
- **Benefit**: Pixel-perfect annotations, no alignment issues

## Core Architecture

### State Management
```typescript
// Single ViewState drives everything
interface ViewState {
  // View geometry - frontend owns this
  views: {
    axial: ViewPlane;
    sagittal: ViewPlane;
    coronal: ViewPlane;
  };
  
  // Annotations - frontend renders these
  crosshair: {
    world_mm: [number, number, number];
    visible: boolean;
  };
  annotations: Annotation[];
  
  // Layers - backend renders these
  layers: Layer[];
}

// Backend only needs the view geometry to render
const sliceSpec = {
  origin_mm: viewPlane.origin_mm,
  u_mm: viewPlane.u_mm,
  v_mm: viewPlane.v_mm,
  dim_px: viewPlane.dim_px
};
```

### Service Layer
```typescript
// CrosshairService manages coordinate transforms
class CrosshairService {
  // Update crosshair from mouse position
  updateFromScreenPos(x: number, y: number, plane: ViewPlane) {
    const world_mm = this.transform.screenToWorld(x, y, plane);
    
    // Update all three views to intersect at this point
    this.updateViewPlanes(world_mm);
  }
  
  // Synchronize view planes to intersect at crosshair
  private updateViewPlanes(world_mm: [number, number, number]) {
    // Update sagittal plane origin to pass through world_mm[0]
    // Update coronal plane origin to pass through world_mm[1]
    // Update axial plane origin to pass through world_mm[2]
  }
}
```

### Component Pattern
```tsx
// OrthogonalViewport manages three synchronized views
function OrthogonalViewport() {
  const viewState = useViewState();
  const crosshairService = useCrosshairService();
  
  const handleMouseMove = (e: MouseEvent, viewType: 'axial' | 'sagittal' | 'coronal') => {
    const plane = viewState.views[viewType];
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Frontend handles all coordinate math
    crosshairService.updateFromScreenPos(x, y, plane);
  };
  
  return (
    <div className="grid grid-cols-2 grid-rows-2">
      <SliceView 
        plane={viewState.views.axial}
        onMouseMove={(e) => handleMouseMove(e, 'axial')}
      />
      {/* ... other views */}
    </div>
  );
}
```

## Implementation Phases

### Sprint 1: Foundation (Week 1)
- Project setup with Vite + React + TypeScript
- Core state management with Zustand
- **Coordinate transform utilities**
- API service layer
- Testing infrastructure

### Sprint 2: Core Components (Week 2)
- **SliceView with annotation overlay**
- **Crosshair synchronization**
- LayerPanel with controls
- FileBrowserPanel with virtualization
- Service implementations

### Sprint 3: Rendering & Integration (Week 3)
- **Full OrthogonalViewport with coordinate sync**
- **Annotation system (markers, ROIs)**
- Golden Layout integration
- Backend facade command
- Performance optimization

## Critical Implementation Details

### 1. Coordinate System Contract
```typescript
// Frontend defines the view
interface SliceSpec {
  origin_mm: [number, number, number];  // Upper-left in world space
  u_mm: [number, number, number];       // Right vector (mm/pixel)
  v_mm: [number, number, number];       // Down vector (mm/pixel)
  dim_px: [number, number];             // Output size
}

// Backend renders exactly what's requested
// No coordinate transforms in backend!
```

### 2. Annotation Rendering
```typescript
// All annotations use world coordinates
interface Annotation {
  id: string;
  world_mm: [number, number, number];
  type: 'marker' | 'roi' | 'measurement';
}

// Frontend projects to screen for rendering
function renderAnnotation(ann: Annotation, plane: ViewPlane) {
  const screenPos = worldToScreen(ann.world_mm, plane);
  if (!screenPos) return null; // Not visible in this plane
  
  return <Marker position={screenPos} />;
}
```

### 3. Perfect Alignment Testing
```typescript
// Integration test to verify alignment
test('annotations align with rendered volume', async () => {
  // Place marker at known anatomical landmark
  const landmark_mm = [0, -20, 15]; // AC point
  
  // Render slice containing landmark
  const slice = await backend.renderSlice({
    origin_mm: [-100, -100, 15],
    u_mm: [1, 0, 0],
    v_mm: [0, 1, 0],
    dim_px: [200, 200]
  });
  
  // Project landmark to screen
  const screen = worldToScreen(landmark_mm, plane);
  
  // Verify pixel at screen position matches expected intensity
  expect(getPixel(slice, screen)).toBe(expectedIntensity);
});
```

## Success Metrics

1. **Pixel-Perfect Annotations**: Zero misalignment between volumes and overlays
2. **Performance**: 60fps slice navigation with annotations
3. **Coordinate Accuracy**: Sub-pixel precision in transforms
4. **Developer Experience**: Clear, testable coordinate system

## Technology Stack

- **React 18**: Modern React with concurrent features
- **TypeScript**: Full type safety for coordinates
- **Vite**: Fast builds and HMR
- **Zustand**: Simple state management
- **SVG/Canvas**: Hybrid rendering for annotations
- **Vitest**: Fast unit testing with coordinate tests
- **Playwright**: E2E testing with visual regression

## Long-term Benefits

1. **Extensibility**: Easy to add new annotation types
2. **Accuracy**: Mathematically correct transforms
3. **Performance**: Frontend renders annotations without backend roundtrip
4. **Maintainability**: Clear ownership of coordinate systems

This architecture ensures the frontend has complete control over the view geometry and coordinate transforms, enabling pixel-perfect annotation rendering while keeping the backend focused on efficient volume rendering.