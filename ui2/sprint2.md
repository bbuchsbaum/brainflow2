# Sprint 2: Core Components & Services

**Duration**: 1 week  
**Goal**: Build the core UI components and service layer with focus on clean architecture and annotation support

## Success Criteria
- [ ] LayerPanel fully functional with batched updates
- [ ] FileBrowserPanel handles large directories efficiently
- [ ] Crosshair synchronization works across all views
- [ ] Annotation overlay renders pixel-perfect
- [ ] Services communicate via event bus
- [ ] Zero circular dependencies

---

## Tickets

### TICKET-201: Event Bus System
**Priority**: Critical  
**Estimate**: 4 hours  
**Assignee**: TBD

**Description**: Implement type-safe event bus for service communication

**Acceptance Criteria**:
- [ ] Event bus with TypeScript event map
- [ ] Type-safe emit/on/off methods
- [ ] Wildcard listener support for debugging
- [ ] Memory leak protection (weak references)
- [ ] Event history for debugging (dev mode)
- [ ] Performance: 10k events/second minimum

**Implementation**:
```typescript
// src/events/EventBus.ts
interface EventMap {
  'crosshair.updated': { world_mm: [number, number, number] };
  'crosshair.clicked': { world_mm: [number, number, number]; button: number };
  'layer.added': { layer: Layer };
  'layer.removed': { layerId: string };
  'layer.patched': { layerId: string; patch: Partial<LayerRender> };
  'annotation.added': { annotation: Annotation };
  'view.resized': { viewType: ViewType; size: [number, number] };
}

export class EventBus {
  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void;
  on<K extends keyof EventMap>(event: K, handler: (data: EventMap[K]) => void): () => void;
  once<K extends keyof EventMap>(event: K, handler: (data: EventMap[K]) => void): () => void;
}
```

---

### TICKET-202: Annotation System Types and Store
**Priority**: High  
**Estimate**: 4 hours  
**Assignee**: TBD  
**Depends on**: TICKET-201

**Description**: Create the annotation system foundation with proper types and state management

**Acceptance Criteria**:
- [ ] Annotation types defined (marker, ROI, measurement, label)
- [ ] Annotation store with CRUD operations
- [ ] Visibility control per annotation type
- [ ] Annotation groups/layers support
- [ ] Selection state management
- [ ] Z-order handling for overlapping annotations

**Implementation**:
```typescript
// src/types/annotations.ts
export interface Annotation {
  id: string;
  type: 'marker' | 'roi' | 'measurement' | 'label';
  world_mm: [number, number, number];
  visible: boolean;
  selected: boolean;
  group?: string;
  style?: AnnotationStyle;
}

export interface Marker extends Annotation {
  type: 'marker';
  symbol: 'circle' | 'cross' | 'square';
  size: number;
}

export interface ROI extends Annotation {
  type: 'roi';
  geometry: {
    type: 'sphere' | 'box' | 'polygon';
    params: number[]; // Depends on type
  };
}

// src/stores/annotations.ts
interface AnnotationState {
  annotations: Map<string, Annotation>;
  selectedIds: Set<string>;
  visibility: Record<Annotation['type'], boolean>;
}
```

---

### TICKET-203: Crosshair Service with Synchronization
**Priority**: Critical  
**Estimate**: 6 hours  
**Assignee**: TBD  
**Depends on**: TICKET-201

**Description**: Implement CrosshairService that manages crosshair state and view synchronization

**Acceptance Criteria**:
- [ ] Updates crosshair from any view mouse position
- [ ] Synchronizes all three orthogonal views
- [ ] Emits events for other services to consume
- [ ] Handles edge cases (cursor outside volume)
- [ ] Smooth tracking without lag
- [ ] Respects view boundaries

**Implementation**:
```typescript
// src/services/CrosshairService.ts
export class CrosshairService {
  constructor(
    private viewState: ViewStateStore,
    private eventBus: EventBus
  ) {}
  
  updateFromScreenPos(x: number, y: number, viewType: ViewType) {
    const plane = this.viewState.getView(viewType);
    const world_mm = CoordinateTransform.screenToWorld(x, y, plane);
    
    // Validate position is within volume bounds
    if (!this.isWithinVolume(world_mm)) return;
    
    // Update crosshair position
    this.viewState.setCrosshair(world_mm);
    
    // Update view planes to intersect at new position
    this.synchronizeViews(world_mm);
    
    // Emit event
    this.eventBus.emit('crosshair.updated', { world_mm });
  }
  
  private synchronizeViews(world_mm: [number, number, number]) {
    // Calculate new origins for each plane to pass through world_mm
    const views = this.viewState.getViews();
    
    // Sagittal: update origin X to world_mm[0]
    // Coronal: update origin Y to world_mm[1]  
    // Axial: update origin Z to world_mm[2]
  }
}
```

---

### TICKET-204: Layer Service with Batch Updates
**Priority**: High  
**Estimate**: 6 hours  
**Assignee**: TBD  
**Depends on**: TICKET-201

**Description**: Implement LayerService with intelligent batching of updates

**Acceptance Criteria**:
- [ ] Batches multiple property changes per frame
- [ ] Manages layer lifecycle (add/remove/reorder)
- [ ] GPU resource management
- [ ] Error handling with recovery
- [ ] Loading states per layer
- [ ] Visibility toggle optimization

**Implementation**:
```typescript
// src/services/LayerService.ts
export class LayerService {
  private pendingPatches = new Map<string, Partial<LayerRender>>();
  private flushTimer: number | null = null;
  
  patchLayer(id: string, patch: Partial<LayerRender>) {
    // Accumulate patches
    const existing = this.pendingPatches.get(id) || {};
    this.pendingPatches.set(id, { ...existing, ...patch });
    
    // Schedule flush
    if (!this.flushTimer) {
      this.flushTimer = requestAnimationFrame(() => {
        this.flushPatches();
      });
    }
  }
  
  private async flushPatches() {
    const patches = Array.from(this.pendingPatches.entries());
    this.pendingPatches.clear();
    this.flushTimer = null;
    
    // Send to backend
    await Promise.all(
      patches.map(([id, patch]) => 
        this.api.patchLayer(id, patch)
      )
    );
    
    // Update store
    patches.forEach(([id, patch]) => {
      this.layerStore.updateLayer(id, patch);
    });
  }
}
```

---

### TICKET-205: Annotation Overlay Component
**Priority**: High  
**Estimate**: 8 hours  
**Assignee**: TBD  
**Depends on**: TICKET-202

**Description**: Create the SVG overlay component that renders annotations on top of slice views

**Acceptance Criteria**:
- [ ] Renders all annotation types correctly
- [ ] Pixel-perfect alignment with volume
- [ ] Handles view resize without losing precision
- [ ] Interactive (hover, click, drag)
- [ ] Efficient rendering (1000+ annotations)
- [ ] Proper z-ordering and selection visuals

**Implementation**:
```typescript
// src/components/views/AnnotationOverlay.tsx
export function AnnotationOverlay({ 
  plane, 
  annotations 
}: { 
  plane: ViewPlane;
  annotations: Annotation[];
}) {
  const transform = useCoordinateTransform();
  
  // Filter and project annotations
  const visibleAnnotations = useMemo(() => {
    return annotations
      .filter(ann => ann.visible)
      .map(ann => ({
        ...ann,
        screenPos: transform.worldToScreen(ann.world_mm, plane)
      }))
      .filter(ann => ann.screenPos !== null);
  }, [annotations, plane]);
  
  return (
    <svg className="absolute inset-0 pointer-events-none">
      <g className="pointer-events-auto">
        {visibleAnnotations.map(ann => (
          <AnnotationRenderer 
            key={ann.id}
            annotation={ann}
            screenPos={ann.screenPos!}
          />
        ))}
      </g>
    </svg>
  );
}

function AnnotationRenderer({ annotation, screenPos }: Props) {
  switch (annotation.type) {
    case 'marker':
      return <MarkerAnnotation {...} />;
    case 'roi':
      return <ROIAnnotation {...} />;
    // etc...
  }
}
```

---

### TICKET-206: LayerPanel Component
**Priority**: High  
**Estimate**: 6 hours  
**Assignee**: TBD  
**Depends on**: TICKET-204

**Description**: Build the LayerPanel with all controls and drag-and-drop reordering

**Acceptance Criteria**:
- [ ] Displays all layers with controls
- [ ] Drag-and-drop reordering
- [ ] Opacity/intensity/threshold sliders
- [ ] Colormap selector with previews
- [ ] GPU status indicators
- [ ] Context menu (delete, duplicate, properties)
- [ ] Keyboard shortcuts (delete key, etc.)

**Implementation**:
```typescript
// src/components/panels/LayerPanel.tsx
export function LayerPanel() {
  const layers = useLayerStore(state => state.layers);
  const layerService = useLayerService();
  
  return (
    <div className="flex flex-col h-full">
      <PanelHeader title="Layers" />
      
      <DndContext onDragEnd={handleDragEnd}>
        <SortableContext items={layers.map(l => l.id)}>
          <div className="flex-1 overflow-y-auto">
            {layers.map(layer => (
              <LayerItem 
                key={layer.id}
                layer={layer}
                onPatch={(patch) => layerService.patchLayer(layer.id, patch)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
```

---

### TICKET-207: FileBrowserPanel with Virtual Scrolling
**Priority**: Medium  
**Estimate**: 8 hours  
**Assignee**: TBD

**Description**: Implement file browser with efficient rendering for large directories

**Acceptance Criteria**:
- [ ] Virtual scrolling with react-arborist
- [ ] Lazy loading on directory expand
- [ ] Search with highlighting
- [ ] File type icons
- [ ] Drag-and-drop to load files
- [ ] Context menu (open, properties)
- [ ] Remember expanded state

**Implementation**:
```typescript
// src/components/panels/FileBrowserPanel.tsx
export function FileBrowserPanel() {
  const [nodes, setNodes] = useState<FileNode[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const fileService = useFileService();
  
  const filteredNodes = useMemo(() => {
    if (!searchTerm) return nodes;
    return filterTreeNodes(nodes, searchTerm);
  }, [nodes, searchTerm]);
  
  return (
    <div className="flex flex-col h-full">
      <SearchInput 
        value={searchTerm}
        onChange={setSearchTerm}
        placeholder="Search files..."
      />
      
      <Tree
        data={filteredNodes}
        openByDefault={false}
        width="100%"
        height={400}
        indent={24}
        rowHeight={32}
        overscanCount={5}
        onToggle={handleToggle}
        onActivate={handleFileOpen}
      >
        {FileNodeRenderer}
      </Tree>
    </div>
  );
}
```

---

### TICKET-208: Reusable UI Components
**Priority**: Medium  
**Estimate**: 6 hours  
**Assignee**: TBD

**Description**: Create the shared UI component library

**Acceptance Criteria**:
- [ ] RangeSlider with proper accessibility
- [ ] ColorMapSelect with gradient previews
- [ ] IconButton with tooltip
- [ ] LoadingSpinner with size variants
- [ ] ErrorBoundary with retry
- [ ] PanelHeader with actions
- [ ] All components fully typed

**Implementation**:
```typescript
// src/components/ui/RangeSlider.tsx
export function RangeSlider({
  min = 0,
  max = 1,
  step = 0.01,
  value,
  onChange,
  label
}: RangeSliderProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-sm w-20">{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1"
      />
      <span className="text-sm w-12 text-right">
        {value.toFixed(2)}
      </span>
    </div>
  );
}

// src/components/ui/ColorMapSelect.tsx
export function ColorMapSelect({ value, onChange }: Props) {
  return (
    <RadixSelect.Root value={value} onValueChange={onChange}>
      <RadixSelect.Trigger>
        <ColorMapPreview name={value} />
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content>
          {COLORMAPS.map(cm => (
            <RadixSelect.Item key={cm} value={cm}>
              <ColorMapPreview name={cm} />
            </RadixSelect.Item>
          ))}
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
```

---

### TICKET-209: Service Integration Tests
**Priority**: High  
**Estimate**: 4 hours  
**Assignee**: TBD  
**Depends on**: All service tickets

**Description**: Comprehensive integration tests for service layer

**Acceptance Criteria**:
- [ ] Test service communication via events
- [ ] Test batch update behavior
- [ ] Test error recovery
- [ ] Test memory leaks
- [ ] Test race conditions
- [ ] Mock transport works correctly

**Test Example**:
```typescript
describe('LayerService batch updates', () => {
  it('should batch multiple updates in same frame', async () => {
    const transport = new MockTransport();
    const service = new LayerService(transport);
    
    // Make rapid updates
    service.patchLayer('layer1', { opacity: 0.5 });
    service.patchLayer('layer1', { colormap: 'viridis' });
    service.patchLayer('layer1', { threshold: [0, 100] });
    
    // Should result in single backend call
    await nextFrame();
    expect(transport.invokeSpy).toHaveBeenCalledTimes(1);
    expect(transport.invokeSpy).toHaveBeenCalledWith('patch_layer', {
      layerId: 'layer1',
      patch: { opacity: 0.5, colormap: 'viridis', threshold: [0, 100] }
    });
  });
});
```

---

## Sprint Review Checklist

- [ ] All components render without errors
- [ ] Services communicate via events only
- [ ] No circular dependencies detected
- [ ] Annotations align perfectly with volume
- [ ] Performance targets met (60fps)
- [ ] Team demo of full UI interaction
- [ ] Sprint 3 scope confirmed

## Notes

- Focus on clean service boundaries
- Test annotation alignment thoroughly  
- Keep components simple and focused
- Document event flow patterns
- Prepare for Golden Layout in Sprint 3