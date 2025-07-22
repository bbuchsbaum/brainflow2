# Crosshair Rendering Architecture

## Decision Summary

Crosshairs should be rendered as UI overlays at the application/canvas level, not embedded in the volume rendering pipeline.

## Context

When migrating from the imperative to declarative rendering API, we discovered that crosshairs were not being rendered in the declarative API output. This led to an important architectural realization: crosshairs are fundamentally a UI concern, not a volume rendering concern.

## Decision

The volume renderer (both imperative and declarative APIs) should focus exclusively on rendering volumetric data. UI overlays such as crosshairs, annotations, measurements, and other interactive elements should be handled by the application layer.

## Rationale

### 1. Separation of Concerns
- **Volume Renderer**: Responsible only for transforming 3D volumetric data into 2D images
- **UI Layer**: Responsible for all interactive overlays and annotations
- This clear separation makes both systems easier to understand, test, and maintain

### 2. Performance Benefits
- Crosshair position changes don't require re-rendering the entire volume
- UI updates can happen at 60+ FPS without touching the GPU volume pipeline
- Reduces GPU memory bandwidth and computation

### 3. Flexibility
- Different views can have different crosshair styles without modifying shaders
- Easy to add features like:
  - Draggable crosshairs
  - Animated crosshairs
  - Multiple crosshairs
  - Crosshair snapping to voxel boundaries
  - Custom crosshair colors/styles per user preference

### 4. Consistency
- One crosshair implementation works across all rendering modes
- Easier to maintain synchronized crosshairs across multiple views
- No need to implement crosshair logic in multiple shader programs

## Implementation

### Current State
- The declarative API (`request_frame`) correctly excludes crosshair rendering
- The `show_crosshair` field in `ViewState` could either be:
  - Removed (since it's not used by the renderer)
  - Kept as a hint for the UI layer

### Recommended UI Implementation

```typescript
// In a Svelte component
<div class="volume-view">
  <canvas bind:this={volumeCanvas} />
  <CrosshairOverlay 
    position={worldToCrosshairPosition(crosshairWorld)}
    visible={viewState.show_crosshair}
    color={userPreferences.crosshairColor}
    thickness={userPreferences.crosshairThickness}
  />
</div>
```

```typescript
// CrosshairOverlay.svelte
<script lang="ts">
  export let position: { x: number; y: number };
  export let visible: boolean = true;
  export let color: string = 'red';
  export let thickness: number = 1;
</script>

{#if visible}
  <svg class="crosshair-overlay">
    <!-- Horizontal line -->
    <line 
      x1="0" 
      y1={position.y} 
      x2="100%" 
      y2={position.y}
      stroke={color}
      stroke-width={thickness}
    />
    <!-- Vertical line -->
    <line 
      x1={position.x} 
      y1="0" 
      x2={position.x} 
      y2="100%"
      stroke={color}
      stroke-width={thickness}
    />
  </svg>
{/if}

<style>
  .crosshair-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none; /* Allow clicks to pass through */
    z-index: 10;
  }
</style>
```

## Migration Path

1. **Immediate**: No changes needed to the renderer - it's already correct
2. **UI Layer**: Implement crosshair rendering in the Svelte components
3. **Documentation**: Update component examples to show crosshair overlay pattern
4. **Deprecation**: Eventually remove crosshair-related code from imperative API

## Testing

The test `test_declarative_center_pixel_and_crosshair` in `test_mni_declarative.rs` validates this architecture by:
1. Confirming volume data renders correctly
2. Verifying that crosshairs are NOT present in the volume render output
3. Documenting that this separation is intentional

## Benefits Summary

- **Cleaner Architecture**: Each system has a single, well-defined responsibility
- **Better Performance**: UI updates don't trigger expensive GPU operations
- **Enhanced Flexibility**: UI can evolve independently of the rendering pipeline
- **Improved Testability**: Volume rendering and UI can be tested in isolation
- **Future-Proof**: Easy to add new overlay features without modifying core renderer

## Related Decisions

This decision aligns with the broader move toward a declarative rendering API where:
- The renderer is a pure function: `ViewState → Image`
- Side effects and interactions are handled at the application level
- The rendering pipeline focuses on performance and correctness