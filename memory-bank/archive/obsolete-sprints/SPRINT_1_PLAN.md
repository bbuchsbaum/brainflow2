# Sprint 1: Rendering Pipeline Completion

**Start Date:** 2025-01-22  
**Duration:** 3-5 days  
**Goal:** Complete the rendering pipeline to display neuroimaging data

## Current State Analysis

After Sprint 0, we have:
- ✅ Complete GPU infrastructure (device, queue, surface)
- ✅ Shader loading and compilation
- ✅ Pipeline creation and management
- ✅ Texture atlas for volume storage
- ✅ Uniform buffer management
- ✅ Basic render loop with draw calls

However, the critical missing piece is proper **atlas UV mapping** in the shader, preventing volumes from displaying correctly.

## Sprint 1 Objectives

### Package 1: Critical Rendering Fixes (1 day)
**Priority: CRITICAL**
- [ ] Fix atlas UV mapping in slice.wgsl shader
- [ ] Pass texture coordinate information from CPU to GPU
- [ ] Test with actual volume data

### Package 2: API Command Completion (1 day)
**Priority: HIGH**
- [ ] Implement update_frame_ubo command in api_bridge
- [ ] Add set_crosshair command
- [ ] Create init_render_loop command that properly initializes service
- [ ] Update TypeScript API wrappers

### Package 3: Rendering Verification (1 day)
**Priority: HIGH**
- [ ] Create simple test app to verify rendering
- [ ] Add render debugging output
- [ ] Implement basic camera controls
- [ ] Test multi-volume overlay

### Package 4: UI Integration (2 days)
**Priority: MEDIUM**
- [ ] Connect VolumeView canvases to render loop
- [ ] Implement resize handling
- [ ] Add basic interaction (pan/zoom)
- [ ] Display orientation labels

### Package 5: Performance Monitoring (1 day)
**Priority: LOW**
- [ ] Add frame timing metrics
- [ ] Create simple FPS counter
- [ ] Log GPU memory usage
- [ ] Basic performance dashboard

## Technical Details

### Critical Fix: Atlas UV Mapping

The current shader has a placeholder:
```wgsl
let atlas_uv = voxel_coord.xy; // Placeholder - Needs real atlas mapping
```

This needs to be replaced with:
```wgsl
// Calculate actual texture coordinates within atlas
let slice_width = layer.texture_coords.z - layer.texture_coords.x;
let slice_height = layer.texture_coords.w - layer.texture_coords.y;
let atlas_uv = vec2<f32>(
    layer.texture_coords.x + voxel_coord.x * slice_width,
    layer.texture_coords.y + voxel_coord.y * slice_height
);
```

### API Commands Needed

1. **update_frame_ubo**: Update view matrices and viewport
2. **set_crosshair**: Set crosshair position for all views
3. **render_frame**: Trigger a render pass
4. **get_frame_stats**: Return FPS and timing info

## Success Criteria

1. **Volume Display**: Can load and display a NIfTI volume
2. **Multi-View**: Three orthogonal views show correct slices
3. **Interaction**: Basic pan/zoom works
4. **Performance**: Maintains 60 FPS for typical volumes
5. **API Complete**: All rendering commands accessible from UI

## Risk Mitigation

1. **Shader Debugging**: Use RenderDoc or similar tools
2. **Test Data**: Use small test volumes first
3. **Incremental Testing**: Test each fix in isolation
4. **Fallback Rendering**: Keep simple test patterns

## Dependencies

- Sprint 0 completion ✅
- Test NIfTI data available ✅
- GPU hardware for testing ✅

## Next Steps After Sprint 1

Once basic rendering works:
- Advanced visualization modes (MIP, volume rendering)
- Measurement tools
- Annotations and overlays
- Performance optimizations
- Multi-modal display

---
*Sprint 1 Ready to Begin*