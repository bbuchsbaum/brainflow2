# Sprint 3: Rendering Pipeline & Integration

**Duration**: 1 week  
**Goal**: Complete the rendering pipeline with Golden Layout integration and prepare for production deployment

## Success Criteria
- [ ] OrthogonalViewport renders all three views synchronized
- [ ] Golden Layout works with React 18
- [ ] Backend facade command implemented
- [ ] Performance meets 60fps target
- [ ] Migration path from Svelte UI ready
- [ ] E2E tests passing

---

## Tickets

### TICKET-301: Backend Facade Command
**Priority**: Critical  
**Estimate**: 4 hours  
**Assignee**: Backend Dev

**Description**: Add the atomic view state update command to Rust backend

**Acceptance Criteria**:
- [ ] `apply_and_render_view_state` command added
- [ ] Accepts JSON ViewState payload
- [ ] Internally calls existing fine-grained commands
- [ ] Returns PNG image data
- [ ] Error handling with clear messages
- [ ] Performance: <16ms for typical update

**Rust Implementation**:
```rust
// core/api_bridge/src/lib.rs
#[derive(Deserialize)]
struct ViewStatePayload {
    views: HashMap<String, ViewPlane>,
    crosshair: CrosshairState,
    layers: Vec<LayerState>,
}

#[command]
#[tracing::instrument(skip_all, err, name = "api.apply_and_render_view_state")]
async fn apply_and_render_view_state(
    view_state_json: String,
    state: State<'_, BridgeState>
) -> BridgeResult<Vec<u8>> {
    let view_state: ViewStatePayload = serde_json::from_str(&view_state_json)
        .map_err(|e| BridgeError::user_input_error("Invalid ViewState", e))?;
    
    // Update all state atomically
    let render_state = state.render_state.lock().await;
    
    // 1. Update crosshair
    render_state.set_crosshair(view_state.crosshair.world_mm)?;
    
    // 2. Update layers
    for layer in view_state.layers {
        render_state.update_layer(&layer.id, layer.render)?;
    }
    
    // 3. Update camera/view
    render_state.update_view_plane(&view_state.views)?;
    
    // 4. Render and return
    render_state.render_to_image_binary().await
}
```

---

### TICKET-302: OrthogonalViewport Container
**Priority**: Critical  
**Estimate**: 8 hours  
**Assignee**: TBD  
**Depends on**: Sprint 2 components

**Description**: Create the main viewport container that manages three synchronized slice views

**Acceptance Criteria**:
- [ ] Renders three SliceView components in grid layout
- [ ] Handles crosshair synchronization
- [ ] Manages view state updates efficiently
- [ ] Keyboard navigation between views
- [ ] Focus indication on active view
- [ ] Responsive layout (adapts to container size)

**Implementation**:
```typescript
// src/components/views/OrthogonalViewport.tsx
export function OrthogonalViewport() {
  const viewState = useViewState();
  const crosshairService = useCrosshairService();
  const [activeView, setActiveView] = useState<ViewType>('axial');
  
  // Coalesced render function
  const render = useCoalescedRender();
  
  // Handle mouse interaction
  const handleMouseMove = useCallback((
    e: React.MouseEvent,
    viewType: ViewType
  ) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    crosshairService.updateFromScreenPos(x, y, viewType);
  }, [crosshairService]);
  
  // Handle keyboard navigation
  useKeyboardShortcuts({
    'ArrowUp': () => crosshairService.moveSlice(activeView, 1),
    'ArrowDown': () => crosshairService.moveSlice(activeView, -1),
    'Tab': () => cycleActiveView(),
  });
  
  return (
    <div className="grid grid-cols-2 grid-rows-2 gap-1 h-full bg-gray-900">
      {/* Axial - Top Left (larger) */}
      <div className="col-span-1 row-span-1">
        <SliceViewWithAnnotations
          plane={viewState.views.axial}
          viewType="axial"
          isActive={activeView === 'axial'}
          onMouseMove={(e) => handleMouseMove(e, 'axial')}
          onFocus={() => setActiveView('axial')}
        />
      </div>
      
      {/* 3D View placeholder - Top Right */}
      <div className="col-span-1 row-span-1 bg-gray-800">
        <div className="flex items-center justify-center h-full text-gray-500">
          3D View (Future)
        </div>
      </div>
      
      {/* Sagittal - Bottom Left */}
      <div className="col-span-1 row-span-1">
        <SliceViewWithAnnotations
          plane={viewState.views.sagittal}
          viewType="sagittal"
          isActive={activeView === 'sagittal'}
          onMouseMove={(e) => handleMouseMove(e, 'sagittal')}
          onFocus={() => setActiveView('sagittal')}
        />
      </div>
      
      {/* Coronal - Bottom Right */}
      <div className="col-span-1 row-span-1">
        <SliceViewWithAnnotations
          plane={viewState.views.coronal}
          viewType="coronal"
          isActive={activeView === 'coronal'}
          onMouseMove={(e) => handleMouseMove(e, 'coronal')}
          onFocus={() => setActiveView('coronal')}
        />
      </div>
    </div>
  );
}
```

---

### TICKET-303: SliceView with Full Integration
**Priority**: Critical  
**Estimate**: 6 hours  
**Assignee**: TBD  
**Depends on**: TICKET-301

**Description**: Complete the SliceView component with rendering and annotation overlay

**Acceptance Criteria**:
- [ ] Efficiently renders backend images
- [ ] Overlays annotations with pixel-perfect alignment
- [ ] Handles resize without losing precision
- [ ] Shows crosshair when visible
- [ ] Displays coordinate information
- [ ] Loading and error states handled

**Implementation**:
```typescript
// src/components/views/SliceViewWithAnnotations.tsx
export function SliceViewWithAnnotations({
  plane,
  viewType,
  isActive,
  onMouseMove,
  onFocus
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<[number, number]>([512, 512]);
  const image = useSliceImage(plane);
  const annotations = useAnnotations();
  const crosshair = useCrosshair();
  
  // Handle resize
  useResizeObserver(canvasRef, (entry) => {
    const { width, height } = entry.contentRect;
    setSize([Math.floor(width), Math.floor(height)]);
  });
  
  // Draw image when ready
  useEffect(() => {
    if (!image || !canvasRef.current) return;
    
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    
    // Clear and draw
    ctx.clearRect(0, 0, size[0], size[1]);
    ctx.drawImage(image, 0, 0, size[0], size[1]);
  }, [image, size]);
  
  return (
    <div 
      className={cn(
        "relative h-full",
        isActive && "ring-2 ring-blue-500"
      )}
      onFocus={onFocus}
      tabIndex={0}
    >
      {/* Backend rendered image */}
      <canvas
        ref={canvasRef}
        width={size[0]}
        height={size[1]}
        className="absolute inset-0 w-full h-full"
        onMouseMove={onMouseMove}
      />
      
      {/* Annotation overlay */}
      <AnnotationOverlay
        plane={plane}
        annotations={annotations}
        size={size}
      />
      
      {/* Crosshair overlay */}
      {crosshair.visible && (
        <CrosshairOverlay
          plane={plane}
          worldPos={crosshair.world_mm}
        />
      )}
      
      {/* Info overlay */}
      <ViewInfo
        viewType={viewType}
        plane={plane}
        crosshair={crosshair}
      />
    </div>
  );
}
```

---

### TICKET-304: Golden Layout React 18 Integration
**Priority**: High  
**Estimate**: 8 hours  
**Assignee**: TBD

**Description**: Integrate Golden Layout with React 18 compatibility fixes

**Acceptance Criteria**:
- [ ] Golden Layout renders without React 18 warnings
- [ ] Portal-based component rendering
- [ ] Layout state persists to localStorage
- [ ] Drag and drop panels working
- [ ] Responsive breakpoints handled
- [ ] Default layout for neuroimaging

**Implementation**:
```typescript
// src/components/layout/GoldenLayoutWrapper.tsx
export function GoldenLayoutWrapper() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<GoldenLayout | null>(null);
  const [portals, setPortals] = useState<Map<string, HTMLElement>>(new Map());
  
  useEffect(() => {
    if (!containerRef.current) return;
    
    // Create layout with React 18 compatibility
    const config: GoldenLayout.Config = {
      content: [{
        type: 'row',
        content: [
          {
            type: 'component',
            componentName: 'FileBrowser',
            width: 20
          },
          {
            type: 'column',
            content: [
              {
                type: 'component',
                componentName: 'OrthogonalViewport',
                height: 70
              },
              {
                type: 'stack',
                content: [
                  {
                    type: 'component',
                    componentName: 'LayerPanel'
                  },
                  {
                    type: 'component',
                    componentName: 'PlotPanel'
                  }
                ]
              }
            ]
          }
        ]
      }]
    };
    
    const myLayout = new GoldenLayout(config, containerRef.current);
    
    // Register components with portal rendering
    myLayout.registerComponent('OrthogonalViewport', (container) => {
      const element = container.getElement()[0];
      setPortals(prev => new Map(prev).set('viewport', element));
    });
    
    myLayout.init();
    setLayout(myLayout);
    
    // Persist state
    const saveLayout = debounce(() => {
      localStorage.setItem('golden-layout-config', 
        JSON.stringify(myLayout.toConfig())
      );
    }, 1000);
    
    myLayout.on('stateChanged', saveLayout);
    
    return () => {
      saveLayout.cancel();
      myLayout.destroy();
    };
  }, []);
  
  return (
    <>
      <div ref={containerRef} className="absolute inset-0" />
      {/* Render components in portals */}
      {portals.get('viewport') && createPortal(
        <OrthogonalViewport />,
        portals.get('viewport')
      )}
      {/* ... other portals */}
    </>
  );
}
```

---

### TICKET-305: Performance Optimization
**Priority**: High  
**Estimate**: 6 hours  
**Assignee**: TBD  
**Depends on**: Core components complete

**Description**: Optimize rendering pipeline for 60fps performance

**Acceptance Criteria**:
- [ ] Measure baseline performance metrics
- [ ] Implement render throttling
- [ ] Add frame time monitoring
- [ ] Optimize annotation rendering
- [ ] Memory profiling shows no leaks
- [ ] 60fps maintained during interaction

**Implementation**:
```typescript
// src/hooks/useCoalescedRender.ts
export function useCoalescedRender() {
  const viewState = useViewState();
  const api = useApiService();
  const [frameTime, setFrameTime] = useState(0);
  
  const pendingRef = useRef<ViewState | null>(null);
  const rafRef = useRef<number | null>(null);
  
  const render = useCallback(async () => {
    if (!pendingRef.current) return;
    
    const start = performance.now();
    const state = pendingRef.current;
    pendingRef.current = null;
    
    try {
      // Single atomic backend call
      const image = await api.applyAndRenderViewState(state);
      
      // Update image cache
      updateImageCache(image);
      
      const elapsed = performance.now() - start;
      setFrameTime(elapsed);
      
      // Warn if frame budget exceeded
      if (elapsed > 16.67) {
        console.warn(`Frame time exceeded: ${elapsed.toFixed(1)}ms`);
      }
    } catch (error) {
      console.error('Render failed:', error);
    }
  }, [api]);
  
  // Subscribe to state changes
  useEffect(() => {
    return viewState.subscribe((state) => {
      pendingRef.current = state;
      
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          render();
        });
      }
    });
  }, [render]);
  
  return { frameTime };
}

// src/components/debug/PerformanceMonitor.tsx
export function PerformanceMonitor() {
  const { frameTime } = useCoalescedRender();
  const [fps, setFps] = useState(60);
  
  useEffect(() => {
    let frames = 0;
    let lastTime = performance.now();
    
    const measureFps = () => {
      frames++;
      const now = performance.now();
      
      if (now - lastTime > 1000) {
        setFps(Math.round(frames * 1000 / (now - lastTime)));
        frames = 0;
        lastTime = now;
      }
      
      requestAnimationFrame(measureFps);
    };
    
    measureFps();
  }, []);
  
  return (
    <div className="fixed bottom-4 right-4 bg-black/80 text-white p-2 text-xs">
      <div>FPS: {fps}</div>
      <div>Frame: {frameTime.toFixed(1)}ms</div>
    </div>
  );
}
```

---

### TICKET-306: Migration Utilities
**Priority**: Medium  
**Estimate**: 4 hours  
**Assignee**: TBD

**Description**: Create utilities to migrate from Svelte UI

**Acceptance Criteria**:
- [ ] Feature flag to switch UIs
- [ ] State converter for critical data
- [ ] Layout migration tool
- [ ] User preferences preserved
- [ ] Documentation for migration
- [ ] Rollback capability

**Implementation**:
```typescript
// src/utils/migration.ts
export class MigrationBridge {
  static async migrateSvelteState(): Promise<Partial<ViewState>> {
    // Read from Svelte stores via window interface
    const svelteState = window.__SVELTE_STORES__?.getState();
    
    if (!svelteState) {
      return getDefaultViewState();
    }
    
    // Convert to new format
    return {
      views: this.convertViews(svelteState.views),
      crosshair: this.convertCrosshair(svelteState.crosshair),
      layers: this.convertLayers(svelteState.layers),
    };
  }
  
  static async migrateUserPreferences() {
    const oldPrefs = localStorage.getItem('brainflow-preferences');
    if (!oldPrefs) return;
    
    const prefs = JSON.parse(oldPrefs);
    
    // Map to new structure
    const newPrefs = {
      theme: prefs.theme || 'dark',
      colormaps: prefs.colormaps || {},
      shortcuts: this.convertShortcuts(prefs.keybindings),
    };
    
    localStorage.setItem('brainflow2-preferences', JSON.stringify(newPrefs));
  }
}

// src/App.tsx
function App() {
  const [useNewUI, setUseNewUI] = useState(() => {
    return import.meta.env.VITE_USE_NEW_UI === 'true' ||
           localStorage.getItem('use-new-ui') === 'true';
  });
  
  useEffect(() => {
    if (useNewUI && !localStorage.getItem('migrated')) {
      MigrationBridge.migrateSvelteState();
      MigrationBridge.migrateUserPreferences();
      localStorage.setItem('migrated', 'true');
    }
  }, [useNewUI]);
  
  if (!useNewUI) {
    return <SvelteBridge />; // Renders old UI
  }
  
  return <NewReactApp />;
}
```

---

### TICKET-307: E2E Testing Suite
**Priority**: High  
**Estimate**: 6 hours  
**Assignee**: TBD

**Description**: Create comprehensive E2E tests with Playwright

**Acceptance Criteria**:
- [ ] Test harness for Tauri app
- [ ] Basic workflow tests (load, view, annotate)
- [ ] Visual regression tests
- [ ] Performance benchmarks
- [ ] Cross-platform tests (Mac, Windows, Linux)
- [ ] CI integration

**Implementation**:
```typescript
// e2e/tests/orthogonal-viewport.spec.ts
import { test, expect } from '@playwright/test';
import { TauriDriver } from '../utils/tauri-driver';

test.describe('Orthogonal Viewport', () => {
  let driver: TauriDriver;
  
  test.beforeEach(async () => {
    driver = await TauriDriver.launch();
  });
  
  test('should synchronize crosshair across views', async ({ page }) => {
    // Load test volume
    await driver.loadVolume('test-data/brain.nii.gz');
    
    // Click on axial view
    const axialView = page.locator('[data-testid="slice-view-axial"]');
    await axialView.click({ position: { x: 256, y: 256 } });
    
    // Verify crosshair appears in all views
    const views = ['axial', 'sagittal', 'coronal'];
    for (const view of views) {
      const crosshair = page.locator(
        `[data-testid="slice-view-${view}"] [data-testid="crosshair"]`
      );
      await expect(crosshair).toBeVisible();
    }
    
    // Take screenshot for visual regression
    await expect(page).toHaveScreenshot('crosshair-sync.png');
  });
  
  test('should maintain 60fps during interaction', async ({ page }) => {
    await driver.loadVolume('test-data/brain.nii.gz');
    
    // Start performance recording
    await page.evaluate(() => performance.mark('interaction-start'));
    
    // Perform rapid crosshair movements
    const axialView = page.locator('[data-testid="slice-view-axial"]');
    for (let i = 0; i < 60; i++) {
      await axialView.hover({ position: { x: 100 + i * 5, y: 256 } });
      await page.waitForTimeout(16); // One frame
    }
    
    // Measure frame times
    const metrics = await page.evaluate(() => {
      performance.mark('interaction-end');
      performance.measure('interaction', 'interaction-start', 'interaction-end');
      
      const measure = performance.getEntriesByName('interaction')[0];
      const paintEvents = performance.getEntriesByType('paint');
      
      return {
        duration: measure.duration,
        frameCount: paintEvents.length,
        avgFrameTime: measure.duration / paintEvents.length
      };
    });
    
    expect(metrics.avgFrameTime).toBeLessThan(17); // 60fps
  });
});
```

---

### TICKET-308: Documentation and Handoff
**Priority**: Medium  
**Estimate**: 4 hours  
**Assignee**: TBD

**Description**: Create comprehensive documentation for the new UI

**Acceptance Criteria**:
- [ ] Architecture overview with diagrams
- [ ] Component documentation
- [ ] Service layer guide
- [ ] Coordinate system explanation
- [ ] Migration guide from Svelte
- [ ] Performance tuning guide

**Documentation Structure**:
```markdown
# Brainflow2 React UI Documentation

## Architecture Overview
- Unidirectional data flow
- Coordinate system ownership
- Service layer patterns

## Core Concepts

### ViewState Management
- Single source of truth
- Coalesced updates
- Undo/redo support

### Coordinate System
- Frontend owns view transforms
- Screen ↔ World conversions
- Annotation alignment

## Component Guide

### OrthogonalViewport
- Synchronized slice views
- Keyboard navigation
- Performance optimization

### Annotation System
- Types and rendering
- Interaction handling
- Custom annotations

## Developer Guide

### Adding New Features
1. Define types
2. Update ViewState
3. Create service
4. Build component
5. Add tests

### Performance Guidelines
- Use React.memo wisely
- Batch state updates
- Profile before optimizing
```

---

## Sprint Review Checklist

- [ ] All tickets completed and merged
- [ ] Performance targets achieved (60fps)
- [ ] E2E tests passing on all platforms
- [ ] Documentation complete
- [ ] Migration path tested
- [ ] Team demo to stakeholders
- [ ] Production deployment plan ready

## Notes

- Backend facade command is critical path
- Test Golden Layout integration early
- Profile performance throughout sprint
- Prepare rollback plan for migration
- Schedule user testing sessions

## Post-Sprint 3 Roadmap

1. **Beta Release** (Week 4)
   - Limited rollout to power users
   - Gather feedback
   - Fix critical issues

2. **Full Release** (Week 5)
   - General availability
   - Deprecate Svelte UI
   - Monitor performance

3. **Future Enhancements**
   - 3D view integration
   - Advanced annotations
   - Plugin system
   - Collaborative features