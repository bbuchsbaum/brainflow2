# TD-CRIT-RUST-001: Fix Shader Compilation

**Priority:** Critical  
**Module:** Rust  
**Stream:** A (Rust)  
**Sprint:** 0  
**Effort:** 2 days  
**Assignable:** Yes  
**Dependencies:** None

### Problem Description
Shader compilation is disabled in `core/render_loop/build.rs` because wgsl_to_wgpu is incompatible with wgpu 25. This prevents any WebGPU rendering from working.

### Current State
- Build script has shader compilation commented out
- Warning message about wgpu 25 incompatibility
- No shaders available at runtime
- Render pipeline cannot be created

### Desired State
- Shaders compile during build process
- Basic vertex/fragment shaders available
- Development hot-reload for shader changes
- Clear shader validation errors

### Technical Approach
1. Investigate actual wgpu version in use (Cargo.toml shows 0.20.0)
2. Either update wgsl_to_wgpu or find alternative shader compilation
3. Create minimal working shaders for slice rendering
4. Add shader validation and error reporting
5. Implement file watching for development

### Implementation Tasks
- [ ] Check actual wgpu version requirements
- [ ] Re-enable or replace wgsl_to_wgpu in build.rs
- [ ] Create shaders/slice_render.wgsl with basic vertex/fragment
- [ ] Add shader module loading in RenderLoopService
- [ ] Implement shader hot-reload for development
- [ ] Add shader compilation test
- [ ] Document shader pipeline

### Acceptance Criteria
- [ ] `cargo build` compiles shaders without errors
- [ ] Shaders load successfully at runtime
- [ ] Basic vertex shader positions vertices correctly
- [ ] Fragment shader outputs color
- [ ] Hot-reload works when shader files change
- [ ] CI successfully builds with shaders

### Testing Approach
- Unit tests: Shader module loading
- Integration tests: Shader compilation in build
- Manual testing: Modify shader and see reload

### Risk Factors
- wgsl_to_wgpu may genuinely be incompatible
- May need to vendor or fork the shader compiler
- WebGPU shader spec compatibility

### Notes
- Check if we can use wgpu's built-in shader compilation
- Consider naga directly for shader compilation
- Reference shaders in test-data if they exist

### Code Locations
- `core/render_loop/build.rs` - Build script
- `core/render_loop/src/lib.rs` - RenderLoopService
- `core/render_loop/shaders/` - Shader directory (create)

---

## Status Updates

**2025-01-21**: Ticket created based on health audit findings