# Sprint 1: Foundation & Core Infrastructure

**Duration**: 1 week  
**Goal**: Establish the foundational architecture with core state management, coordinate system, and API layer

## Success Criteria
- [ ] React project builds and runs with hot reload
- [ ] ViewState store with coalescing middleware works
- [ ] Coordinate transform utilities have 100% test coverage
- [ ] Mock backend can simulate volume rendering
- [ ] Basic slice view renders test image

---

## Tickets

### TICKET-101: Project Setup and Configuration
**Priority**: High  
**Estimate**: 4 hours  
**Assignee**: TBD

**Description**: Initialize React project with all necessary tooling and configuration

**Acceptance Criteria**:
- [ ] Vite project created with React 18 + TypeScript
- [ ] Tailwind CSS configured with custom neuroimaging color palette
- [ ] ESLint + Prettier configured
- [ ] Path aliases configured (@/components, @/services, etc.)
- [ ] Git hooks for pre-commit linting
- [ ] Basic folder structure created

**Technical Details**:
```bash
# Commands to run
npm create vite@latest ui2 -- --template react-ts
cd ui2
npm install -D tailwindcss postcss autoprefixer @types/node
npm install zustand immer react-error-boundary
```

---

### TICKET-102: Coordinate Transform System
**Priority**: Critical  
**Estimate**: 8 hours  
**Assignee**: TBD  
**Depends on**: TICKET-101

**Description**: Implement the coordinate transformation utilities that convert between screen, view, and world space

**Acceptance Criteria**:
- [ ] `CoordinateTransform` class implemented with full TypeScript types
- [ ] `screenToWorld()` correctly transforms mouse positions
- [ ] `worldToScreen()` correctly projects 3D points with plane intersection test
- [ ] `viewPlaneFromSlice()` creates ViewPlane from backend SliceSpec
- [ ] 100% test coverage with known test cases
- [ ] Handle edge cases (points behind plane, numerical precision)

**Implementation**:
```typescript
// src/utils/coordinates.ts
export class CoordinateTransform {
  static screenToWorld(
    x: number, 
    y: number, 
    plane: ViewPlane
  ): [number, number, number] {
    // Implementation
  }
  
  static worldToScreen(
    world_mm: [number, number, number],
    plane: ViewPlane
  ): [number, number] | null {
    // Implementation with plane intersection test
  }
  
  static isPointOnPlane(
    world_mm: [number, number, number],
    plane: ViewPlane,
    tolerance: number = 0.5
  ): boolean {
    // Check if point is within tolerance of plane
  }
}
```

**Test Cases**:
- Axial plane at z=0, click at center → [0, 0, 0]
- Sagittal plane at x=10, world point [10, 20, 30] → screen coords
- Point behind plane → null
- Oblique plane transforms

---

### TICKET-103: ViewState Store with Coalescing
**Priority**: Critical  
**Estimate**: 6 hours  
**Assignee**: TBD  
**Depends on**: TICKET-102

**Description**: Implement the core ViewState store with coalescing middleware to batch updates

**Acceptance Criteria**:
- [ ] ViewState interface fully defined with TypeScript
- [ ] Zustand store created with proper typing
- [ ] Coalescing middleware batches updates to one per frame
- [ ] Undo/redo middleware integrated (zundo)
- [ ] Store updates trigger at most 60 updates per second
- [ ] Memory leak test passes (rapid updates for 60 seconds)

**Implementation**:
```typescript
// src/stores/viewState.ts
interface ViewState {
  views: {
    axial: ViewPlane;
    sagittal: ViewPlane;
    coronal: ViewPlane;
  };
  crosshair: {
    world_mm: [number, number, number];
    visible: boolean;
  };
  layers: Layer[];
}

const useViewState = create<ViewState>()(
  undo(
    coalesce(
      immer((set) => ({
        // Initial state
      }))
    )
  )
);
```

---

### TICKET-104: Backend Transport Interface
**Priority**: High  
**Estimate**: 4 hours  
**Assignee**: TBD  
**Depends on**: TICKET-101

**Description**: Create the transport abstraction layer for backend communication

**Acceptance Criteria**:
- [ ] `BackendTransport` interface defined
- [ ] `TauriTransport` implementation for production
- [ ] `MockTransport` implementation for testing
- [ ] Transport can be injected/swapped at runtime
- [ ] Error handling with proper error types
- [ ] Request ID tracking for debugging

**Implementation**:
```typescript
// src/services/transport.ts
export interface BackendTransport {
  invoke<T>(cmd: string, args?: unknown): Promise<T>;
}

export class TauriTransport implements BackendTransport {
  async invoke<T>(cmd: string, args?: unknown): Promise<T> {
    return window.__TAURI__.invoke(cmd, args);
  }
}

export class MockTransport implements BackendTransport {
  async invoke<T>(cmd: string, args?: unknown): Promise<T> {
    // Return mock data based on command
  }
}
```

---

### TICKET-105: API Service Layer
**Priority**: High  
**Estimate**: 6 hours  
**Assignee**: TBD  
**Depends on**: TICKET-104

**Description**: Implement the API service that wraps backend commands

**Acceptance Criteria**:
- [ ] `ApiService` class with all current backend commands
- [ ] Proper TypeScript types for all commands
- [ ] Uses injected transport
- [ ] `applyAndRenderViewState()` method for atomic updates
- [ ] Image decoding with `createImageBitmap()`
- [ ] Error handling with user-friendly messages

**Implementation**:
```typescript
// src/services/api.ts
export class ApiService {
  constructor(private transport: BackendTransport) {}
  
  async applyAndRenderViewState(state: ViewState): Promise<ImageBitmap> {
    const imageData = await this.transport.invoke<Uint8Array>(
      'apply_and_render_view_state',
      { viewStateJson: JSON.stringify(state) }
    );
    
    const blob = new Blob([imageData], { type: 'image/png' });
    return createImageBitmap(blob);
  }
  
  async loadFile(path: string): Promise<VolumeHandle> {
    return this.transport.invoke('load_file', { path });
  }
}
```

---

### TICKET-106: Testing Infrastructure
**Priority**: High  
**Estimate**: 4 hours  
**Assignee**: TBD  
**Depends on**: TICKET-101

**Description**: Set up comprehensive testing infrastructure

**Acceptance Criteria**:
- [ ] Vitest configured with TypeScript
- [ ] React Testing Library set up
- [ ] Mock service factory utilities
- [ ] Coordinate transform test utilities
- [ ] Visual regression test setup (for later)
- [ ] Coverage reporting configured (target: 90%)

**Test Utilities**:
```typescript
// src/test-utils/index.ts
export function createMockViewPlane(type: 'axial' | 'sagittal' | 'coronal'): ViewPlane {
  // Return standard test planes
}

export function expectNearlyEqual(
  actual: number[], 
  expected: number[], 
  tolerance = 0.001
) {
  // Custom matcher for coordinate comparisons
}
```

---

### TICKET-107: Basic Slice View Component
**Priority**: Medium  
**Estimate**: 6 hours  
**Assignee**: TBD  
**Depends on**: TICKET-103, TICKET-105

**Description**: Create the basic SliceView component that renders backend images

**Acceptance Criteria**:
- [ ] Component renders canvas element
- [ ] Displays backend-provided image
- [ ] Handles loading and error states
- [ ] Mouse position tracked in world coordinates
- [ ] Resize observer updates canvas size
- [ ] No memory leaks on unmount

**Implementation**:
```typescript
// src/components/views/SliceView.tsx
export function SliceView({ plane }: { plane: ViewPlane }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mouseWorld, setMouseWorld] = useState<[number, number, number] | null>(null);
  
  // Track mouse position
  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const world = CoordinateTransform.screenToWorld(x, y, plane);
    setMouseWorld(world);
  };
  
  return (
    <div className="relative">
      <canvas 
        ref={canvasRef}
        onMouseMove={handleMouseMove}
      />
      {mouseWorld && (
        <div className="absolute top-0 left-0 text-xs">
          {mouseWorld.map(v => v.toFixed(1)).join(', ')}
        </div>
      )}
    </div>
  );
}
```

---

### TICKET-108: Coordinate System Integration Tests
**Priority**: Critical  
**Estimate**: 4 hours  
**Assignee**: TBD  
**Depends on**: TICKET-102, TICKET-107

**Description**: Create comprehensive integration tests for coordinate system

**Acceptance Criteria**:
- [ ] Test orthogonal planes (axial, sagittal, coronal)
- [ ] Test oblique plane transforms
- [ ] Test round-trip accuracy (screen → world → screen)
- [ ] Test crosshair synchronization across views
- [ ] Test edge cases (boundaries, numerical limits)
- [ ] Visual test to verify annotation alignment

**Test Example**:
```typescript
test('crosshair synchronization across views', () => {
  const world = [10, 20, 30];
  const views = createOrthogonalViews(world);
  
  // Click on axial view
  const axialScreen = worldToScreen(world, views.axial);
  expect(axialScreen).not.toBeNull();
  
  // Verify same world point appears in other views
  const sagittalScreen = worldToScreen(world, views.sagittal);
  const coronalScreen = worldToScreen(world, views.coronal);
  
  expect(sagittalScreen).not.toBeNull();
  expect(coronalScreen).not.toBeNull();
});
```

---

## Sprint Review Checklist

- [ ] All tickets completed and tested
- [ ] Coordinate system documentation written
- [ ] Team demo of basic slice rendering
- [ ] Performance baseline established
- [ ] No memory leaks detected
- [ ] Sprint 2 tickets refined and ready

## Notes

- Focus on getting coordinate system perfect - it's the foundation
- Don't optimize prematurely, but keep 60fps target in mind
- Write tests first for coordinate transforms
- Document any backend API assumptions discovered