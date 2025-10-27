# Brainflow Implementation Roadmap

**Date:** 2025-01-21  
**Target:** Phase 1 MVP Completion  
**Timeline:** 8-10 weeks  
**Current Completion:** ~15%

## Reality Check (2025-10-28)
- Three‑view sync core is in place: backend `recalculate_all_views` computes per‑view rectangles atomically and the UI locked‑layout path consumes it.
- Multi‑view batch rendering exists behind a feature flag; legacy per‑view render remains default for safety.
- GPU resource lifecycle hardened: `LayerLease` RAII + watchdog + atlas pressure telemetry and auto‑eviction with backoff.
- Typed shader bindings trial (feature `typed-shaders`) is live for the optimized slice shader; runtime WGSL remains default. CI check and benches exist.
- Benches moved to `core/render_loop_benches`; upload numbers show parity runtime vs typed; typed render bench needs a small fix (texture view dimension).
- See sprint notes: `memory-bank/sprints/Sprint_Foundations_Upgrade_1.md` and shader plan: `memory-bank/SHADER_BINDINGS_PLAN.md`.

## Overview

This roadmap provides a structured path from the current state (partially implemented infrastructure) to a fully functional Phase 1 MVP that meets the blueprint requirements. The approach prioritizes establishing core functionality before adding advanced features.

## Guiding Principles

1. **Fix the Critical Path First** - No new features until basic rendering works
2. **Test as You Build** - Add tests with each component
3. **Integrate Early** - Connect components as soon as possible
4. **Visible Progress** - Each sprint should show visual improvements
5. **Technical Debt Prevention** - Fix issues properly, don't add workarounds

---

## Phase 0: Foundation Repair (Week 1-2) 🔧

**Goal:** Fix critical infrastructure issues blocking all progress

### Week 1 Tasks:
- [x] **Shader Pipeline (Runtime)** (CD-001)
  - Switch to runtime WGSL loading and validation
  - Keep wgpu pinned (0.20.x) for stability
  - Basic slice shaders in repo (WGSL)
  - Add hot-reload in dev via polling watcher

- [x] **Fix Type Generation** (CD-004)
  - xtask ts-bindings operational (ts-rs exports)
  - API package consumes generated types
  - Add CI check for drift (planned)

- [x] **Create Root package.json** (HD-002)
  - Monorepo scripts present; update to reflect `ui2`
  - Align CI references (planned)

- [x] **Fix Missing API Function** (CD-003)
  - `update_frame_ubo` implemented and exposed
  - TypeScript API wrapper calls unified `render_view`

### Week 1 Deliverable:
- Shaders compile
- Types generate correctly
- CI fully green

### Week 2 Tasks:
- [x] **Complete NIfTI Loader** (CD-007)
  - neuroim-based loader implemented; unit tests present
  - VolumeSendable stored in registry
  - Handles returned with metadata

- [x] **Fix Data Flow Path** (CD-002)
  - loader → registry → GPU path working
  - `request_layer_gpu_resources` implemented
  - Add/expand integration tests (planned)

- [x] **WebGPU Pipeline Setup** (CD-001)
  - Render pipeline in place
  - Bind groups and atlas integration present
  - Slice rendering functional and optimized path available

### Week 2 Deliverable:
- Can load a NIfTI file
- Data reaches GPU
- Something renders (even if wrong)

---

## Phase 1: Core Visualization (Week 3-5) 🎨

**Goal:** Achieve basic neuroimaging visualization

### Week 3: Single Slice Rendering
- [ ] **Complete Render Loop**
  - Implement proper vertex data
  - Fix coordinate transformations
  - Render single axial slice correctly
  - Add pan/zoom interaction

- [ ] **Connect UI to Rendering**
  - Wire VolumeView to render loop
  - Implement resize handling
  - Add frame timing
  - Show debug overlay

- [ ] **Add Basic Tests**
  - Render loop unit tests
  - VolumeView component test
  - Load → render integration test

### Week 3 Deliverable:
- Single axial slice renders correctly
- Can pan and zoom
- Performance metrics visible

### Week 4: Three-Panel Implementation
- [ ] **Implement 3-Panel Layout** (CD-006)
  - Create three WebGPU contexts
  - Implement orthogonal views
  - Add view synchronization
  - Handle resize properly

- [ ] **Crosshair Synchronization**
  - Implement crosshair store updates
  - Connect to UBO updates
  - Visual crosshair rendering
  - Click coordination

- [ ] **Slice Navigation**
  - Scroll to change slices
  - Keyboard navigation
  - Slice number display
  - Proper bounds checking

### Week 4 Deliverable:
- Three orthogonal views working
- Crosshair synchronizes between views
- Can navigate through volume

### Week 5: Multi-Layer Rendering
- [ ] **Layer Management**
  - Multiple texture uploads
  - Layer ordering
  - Basic compositing
  - GPU resource management

- [ ] **Layer Controls UI**
  - Implement LayerPanel component
  - Opacity control
  - Visibility toggle
  - Layer reordering

- [ ] **Performance Optimization**
  - Texture atlas efficiency
  - Frame rate monitoring
  - Memory usage tracking
  - Benchmark against requirements

### Week 5 Deliverable:
- Can load multiple volumes
- Basic layer compositing works
- 60+ FPS maintained

Notes (sync + batching)
- View sync status: Crosshair and dimension updates coalesce; locked‑layout resizing updates all panels consistently using `recalculate_all_views`.
- Batch rendering status: `render_views` path is gated behind a feature flag; verify via status bar toggle. Keep legacy per‑view path as default until more QA and perf data lands.

---

## Phase 2: Extended Features (Week 6-8) 🚀

**Goal:** Add remaining MVP features

### Week 6: Surface Rendering
- [ ] **GIFTI Loader**
  - Implement GIFTI parsing
  - Surface data structures
  - Integration with registry

- [ ] **SurfaceView Component**
  - Three.js scene setup
  - Mesh rendering
  - Camera controls
  - Lighting setup

- [ ] **Surface Integration**
  - Add to layer system
  - Coordinate with volume views
  - Performance optimization

### Week 6 Deliverable:
- Can load and display surfaces
- Surfaces integrate with layer system

### Week 7: Visualization Features
- [ ] **Colormap System**
  - Implement colormap LUT
  - UI colormap selector
  - Window/level controls
  - Threshold controls

- [ ] **SharedArrayBuffer** (CD-005)
  - Implement SAB allocation
  - Zero-copy transfer
  - Performance validation

- [ ] **Advanced Interactions**
  - World coordinate picking
  - Measurement tools
  - Screenshot export

### Week 7 Deliverable:
- Full visualization controls
- Zero-copy performance
- Interactive measurements

### Week 8: UI Polish & Integration
- [ ] **Complete UI Components**
  - Legend drawer
  - Status bar
  - Settings panel
  - About dialog

- [ ] **Error Handling**
  - User-friendly error messages
  - Recovery mechanisms
  - Loading states
  - Progress indicators

- [ ] **Documentation**
  - User guide
  - Developer guide
  - API documentation
  - Example datasets

### Week 8 Deliverable:
- Polished, complete UI
- Comprehensive error handling
- Basic documentation

---

## Phase 3: Quality & Release Prep (Week 9-10) 📦

**Goal:** Stabilize for release

### Week 9: Testing & Performance
- [ ] **Test Coverage**
  - Critical path integration tests
  - Component test suite
  - E2E user workflows
  - Performance benchmarks

- [ ] **Cross-Platform Testing**
  - Windows validation
  - macOS validation
  - Linux validation
  - GPU compatibility

- [ ] **Performance Tuning**
  - Meet all blueprint targets
  - Memory optimization
  - Startup time optimization

### Week 10: Release Preparation
- [ ] **Bug Fixes**
  - Address all critical bugs
  - Fix high-priority issues
  - Polish rough edges

- [ ] **Release Artifacts**
  - Code signing setup
  - Distribution packages
  - Installation testing
  - Release notes

- [ ] **Future Planning**
  - Document remaining work
  - Plan Phase 2 features
  - Update roadmap

---

## Risk Mitigation Strategies

### Technical Risks:
- **WebGPU Compatibility**: Have WebGL fallback plan
- **Performance Issues**: Profile early and often
- **Platform Differences**: Test on all platforms weekly

### Process Risks:
- **Scope Creep**: Strictly follow roadmap
- **Integration Issues**: Integrate components ASAP
- **Technical Debt**: Allocate 20% time for fixes

## Success Metrics

### Phase 0 Complete When:
- CI fully green
- Can load files
- Basic rendering works

### Phase 1 Complete When:
- 3-panel view functional
- Multi-layer rendering works
- Meets performance targets

### Phase 2 Complete When:
- All MVP features implemented
- Surface rendering works
- UI is feature-complete

### Phase 3 Complete When:
- Test coverage >60%
- All platforms validated
- Release packages built

## Resource Requirements

### Team Composition:
- **Rust Developer**: 60% allocation
- **Frontend Developer**: 80% allocation
- **Full-Stack Developer**: 40% allocation

### Infrastructure:
- GPU-enabled CI runners
- Cross-platform test machines
- Code signing certificates

## Conclusion

This roadmap provides a realistic path to MVP completion in 10 weeks. The phased approach ensures visible progress while maintaining quality. Success depends on fixing the critical rendering pipeline first, then building features incrementally with proper testing.

The key is to resist adding new features until each phase is complete. With disciplined execution, the strong architectural foundation will enable rapid progress once the core visualization pipeline is working.
