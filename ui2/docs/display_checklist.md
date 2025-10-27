# Display Settings Implementation Checklist

This document tracks the implementation status of display settings for volume rendering in Brainflow.

## Per-Layer Display Settings
These settings apply individually to each volume layer and are controlled through the Volume Properties panel.

### ✅ Implemented in UI

| Setting | Status | Location | Notes |
|---------|--------|----------|-------|
| Interpolation Mode | ✅ **WORKING** | VolumePanel.tsx:228-232 | Nearest/Linear toggle, fully functional |

### 🎨 UI Only (No Backend Implementation)

| Setting | Status | UI Location | Backend Needed | Priority |
|---------|--------|-------------|----------------|----------|
| Slice Border | 🎨 UI Ready | VolumePanel.tsx:234-240 | render_loop shader | Medium |
| Orientation Markers | 🎨 UI Ready | VolumePanel.tsx:242-248 | SliceRenderer overlay | Medium |
| Value on Hover | 🎨 UI Ready | VolumePanel.tsx:250-256 | Mouse event + value sampling | High |

### 📋 Planned (Not Yet in UI)

| Setting | Priority | Description | Estimated Effort |
|---------|----------|-------------|------------------|
| Slice Thickness | Low | Control slice averaging/MIP thickness | Medium |
| Resampling Quality | Low | Override automatic resampling | Low |
| Clip Planes | Low | Clip volume to specific bounds | High |
| Blend Mode | Medium | Alpha/Additive/Maximum blending for overlays | Medium |

## Global Display Settings
These settings apply to all views and are controlled separately (not per-layer).

### ✅ Implemented

| Setting | Status | Location | Notes |
|---------|--------|----------|-------|
| Crosshair Visibility | ✅ WORKING | CrosshairSettingsStore | Global toggle in settings |
| Crosshair Color | ✅ WORKING | CrosshairSettingsStore | RGB color picker |
| Crosshair Style | ✅ WORKING | CrosshairSettingsStore | Solid/Dashed/Dotted |

### 📋 Planned Global Settings

| Setting | Priority | Description |
|---------|----------|-------------|
| Background Color | Low | View background color |
| Grid Overlay | Low | Reference grid for spatial orientation |
| Zoom Level Sync | Medium | Synchronize zoom across all views |
| Annotation Visibility | High | Show/hide all annotations |

## Implementation Notes

### Per-Layer Settings Architecture

**Current State:**
- UI components exist in `VolumePanel.tsx`
- State is local to the component (React.useState)
- No persistence or backend integration

**Next Steps:**
1. **Add to Layer State**: Extend `LayerRender` type to include display settings
   ```typescript
   interface LayerRender {
     // ... existing fields
     displaySettings?: {
       showBorder: boolean;
       showOrientationMarkers: boolean;
       showValueOnHover: boolean;
     }
   }
   ```

2. **Persist to ViewState**: Include in ViewState so settings survive layer selection changes

3. **Backend Integration**: Pass settings to render commands where applicable

### Implementation Priorities

**High Priority (User-Facing Impact):**
- ✅ Interpolation Mode (DONE)
- 🔨 Value on Hover - Very useful for inspecting data
- 🔨 Slice Border - Important for multi-volume workflows

**Medium Priority (Nice to Have):**
- Orientation Markers - Helpful but redundant with other UI elements
- Blend Mode - Useful for functional overlays on anatomical

**Low Priority (Advanced Features):**
- Slice Thickness - Niche use case
- Resampling Quality - Usually automatic is fine
- Clip Planes - Advanced visualization

## Backend Work Required

### For Slice Border
**File**: `core/render_loop/src/shaders/slice_2d.wgsl`
- Add uniform for border color and width
- Add fragment shader logic to draw border on edges
- Pass setting through render command

**Estimated Effort**: 2-3 hours

### For Orientation Markers
**File**: `ui2/src/components/views/SliceRenderer.tsx` or create new overlay component
- Render L/R/A/P text labels as SVG/Canvas overlay
- Position based on slice orientation
- Use view metadata to determine which labels to show

**Estimated Effort**: 3-4 hours

### For Value on Hover
**Files**:
- `ui2/src/components/views/SliceRenderer.tsx` - Mouse event handling
- `ui2/src/services/apiService.ts` - Add command to sample voxel value at world position
- `core/api_bridge/src/lib.rs` - New Tauri command `sample_voxel_value`

**Estimated Effort**: 4-6 hours (includes backend sampling logic)

## Testing Checklist

When implementing backend for each setting:

- [ ] Setting persists when switching between layers
- [ ] Setting is included in ViewState serialization
- [ ] Setting updates trigger render without full reload
- [ ] Setting respects layer visibility (disabled when layer hidden)
- [ ] Setting tooltip explains what it does
- [ ] Setting works with multiple layers loaded
- [ ] Setting has sensible default value

## Related Documentation

- [Volume Panel Architecture](../SURFACE_VISUALIZATION_ARCHITECTURE.md)
- [Layer State Management](../../memory-bank/ADR-001-architecture.md)
- [Shader System](../../core/render_loop/README.md)

---

**Last Updated**: 2025-01-27
**Maintained By**: Development Team
