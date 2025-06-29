# Quick Reference: Key Review Areas

## 🔴 Critical Performance Paths

### 1. GPU Render → Canvas Display
**File**: `/ui/src/lib/components/SliceViewerGPU.svelte`
**Current Flow**:
```
GPU Render → PNG Encode → IPC Transfer → PNG Decode → Canvas Draw
```
**Concern**: Multiple encoding/decoding steps
**Alternative**: Direct pixel buffer transfer?

### 2. Mouse Move → Crosshair Update
**Files**: Multiple components
**Current Flow**:
```
Mouse Event → World Coord Calc → Store Update → All Views Re-render
```
**Concern**: Frequency of updates (60+ per second)
**Question**: Debouncing strategy?

### 3. Virtual Scrolling in File Browser
**File**: `/ui/src/lib/components/TreeBrowser.svelte`
**Implementation**: Reactive slicing of visible nodes
**Test Case**: 10,000+ files
**Metric**: Scroll FPS and memory usage

## 🟡 Architecture Decisions

### 1. Zustand + Svelte 5 Runes
**Pattern**:
```typescript
// Zustand store
const useLayerStore = create<LayerState>(() => ({ ... }));

// Svelte component
$effect(() => {
  const unsubscribe = useLayerStore.subscribe(state => {
    // Update local state
  });
  return unsubscribe;
});
```
**Question**: Is this the best pattern?

### 2. Component Hierarchy
```
VolumeView
  └── OrthogonalViewGPU
      └── SliceViewerGPU (×3)
          ├── Canvas (GPU rendered)
          └── Canvas (Annotations)
```
**Concern**: Prop drilling
**Alternative**: Context? Stores?

### 3. GPU Resource Management
**Current**: Explicit request, implicit release
**Question**: Who owns GPU resources?
**Risk**: Memory leaks

## 🟢 Recent Additions Needing Review

### 1. Annotation System
**Files**: `/ui/src/lib/components/annotations/*`
**Features**:
- Canvas-based rendering
- World/screen coordinates
- Multiple annotation types
**Review**: Performance, accuracy, integration

### 2. Colormap Mapping
**File**: `/ui/src/lib/utils/colormaps.ts`
**Purpose**: Name to GPU ID mapping
**Review**: Completeness, extensibility

### 3. Window/Level Controls
**Integration**: GPU uniform updates
**Performance**: Frequent updates during drag
**Review**: Debouncing, GPU efficiency

## 📊 Metrics to Measure

### Performance
1. Time to first meaningful paint (volume load)
2. Frame rate during interaction
3. Memory usage over time
4. GPU memory allocation
5. IPC message frequency/size

### Code Quality
1. TypeScript coverage (no `any`)
2. Component test coverage
3. Error handling coverage
4. Documentation completeness
5. Bundle size analysis

## 🎯 Specific Questions for Reviewers

### Gemini (Architecture Focus)
1. **State Management**: Better pattern for Zustand + Svelte 5?
2. **Component Design**: How to reduce prop drilling?
3. **Performance**: Best practices for reactive computations?
4. **Testing**: Component testing strategy for GPU-based components?
5. **Scalability**: Architecture for 10+ simultaneous volumes?

### O3 (Technical Focus)
1. **GPU Pipeline**: Optimal pixel data transfer method?
2. **Memory**: Leak detection and prevention strategies?
3. **Concurrency**: Race condition prevention patterns?
4. **Types**: Automated type generation improvements?
5. **Security**: File handling vulnerabilities?

## 🚀 Expected Outcomes

1. **Immediate Fixes** (< 1 week)
   - Memory leak fixes
   - Type safety improvements
   - Critical bug fixes

2. **Quick Wins** (1-2 weeks)
   - Performance optimizations
   - State management cleanup
   - Error handling

3. **Architecture Improvements** (2-4 weeks)
   - Component refactoring
   - State pattern updates
   - Testing implementation

4. **Long-term** (1+ month)
   - Full GPU pipeline optimization
   - Comprehensive test suite
   - Documentation overhaul