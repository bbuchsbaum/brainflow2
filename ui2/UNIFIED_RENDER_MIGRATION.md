# Unified Render Pipeline Migration Guide

## Overview
We've created a unified `RenderContext` interface to replace the confusing tag/viewType split. This document shows how to migrate components to use the new system.

## The Problem We're Solving
Currently we have two parallel rendering paths:
- **SliceView**: Uses `viewType` ('axial', 'sagittal', 'coronal')
- **MosaicView**: Uses `tag` ('mosaic-default-axial-0', etc.)

This causes confusion and brittleness. The unified system uses a single `RenderContext` that works for both.

## New RenderContext Interface

```typescript
interface RenderContext {
  id: string;                    // Unique identifier
  type: 'slice' | 'mosaic-cell'; // Context type
  viewPlane?: ViewPlane;          // Optional view plane
  dimensions: { width, height };  // Render dimensions
  metadata?: {                   // Optional metadata
    viewType?: string;
    sliceIndex?: number;
    workspaceId?: string;
  };
}
```

## Migration Examples

### SliceView Migration

**Before:**
```typescript
// In SliceView.tsx
const { canvasRef, isLoading, error } = useRenderCanvas({
  viewType: viewId,  // 'axial', 'sagittal', or 'coronal'
  onImageReceived: handleImageReceived,
  customRender: drawCrosshairs
});
```

**After:**
```typescript
// In SliceView.tsx
import { RenderContextFactory } from '@/types/renderContext';

// Create context once
const renderContext = useMemo(() => 
  RenderContextFactory.createSliceContext(
    viewId,      // 'axial', 'sagittal', or 'coronal'
    width,
    height,
    viewPlane
  ), [viewId, width, height, viewPlane]
);

// Use context in hook
const { canvasRef, isLoading, error } = useRenderCanvas({
  context: renderContext,  // Use unified context
  onImageReceived: handleImageReceived,
  customRender: drawCrosshairs
});
```

### MosaicCell Migration

**Before:**
```typescript
// In MosaicCell.tsx
<SliceRenderer
  tag={tag}  // 'mosaic-default-axial-0'
  width={width}
  height={height}
  customRender={customRender}
/>
```

**After:**
```typescript
// In MosaicCell.tsx
import { RenderContextFactory } from '@/types/renderContext';

// Create context for this cell
const renderContext = useMemo(() =>
  RenderContextFactory.createMosaicCellContext(
    workspaceId,   // 'mosaic-default'
    axis,          // 'axial'
    sliceIndex,    // 0, 1, 2, etc.
    width,
    height,
    viewPlane
  ), [workspaceId, axis, sliceIndex, width, height, viewPlane]
);

// Use in SliceRenderer (which internally uses useRenderCanvas)
<SliceRenderer
  context={renderContext}  // Use unified context
  customRender={customRender}
/>
```

## Benefits

1. **Single Source of Truth**: One interface for all rendering contexts
2. **Better Debugging**: Context type is explicit in the `RenderContext`
3. **Easier to Understand**: No more confusion about when to use tag vs viewType
4. **Type Safety**: TypeScript knows exactly what's in the context
5. **Backward Compatible**: Old code still works during migration

## Implementation Status (2025-01-08)

- ✅ Created `RenderContext` interface and factory with unique ID generation
- ✅ Updated `useRenderCanvas` to support both new and legacy approaches
- ✅ Enhanced `RenderStateStore` with legacy ID mapping
- ✅ Migrated `MosaicCell` to generate unique RenderContexts
- ✅ Migrated `SliceView` to generate unique RenderContexts
- ✅ Removed `ResourceMonitor` (was causing false GPU exhaustion)
- ⏳ Removing direct tag/viewType usage (in progress)

## Next Steps

1. Gradually migrate SliceView to use RenderContext
2. Gradually migrate MosaicView/MosaicCell to use RenderContext
3. Once all components migrated, remove legacy tag/viewType support
4. Simplify RenderStateStore to only use context.id as key

## Testing During Migration

Both approaches work simultaneously:
```typescript
// These are equivalent and work at the same time:

// Legacy approach (still works)
useRenderCanvas({ viewType: 'axial' })

// New approach (preferred)
const context = RenderContextFactory.createSliceContext('axial', 800, 600);
useRenderCanvas({ context })
```

The store key will be the same ('slice-axial' from context.id or 'axial' from viewType).