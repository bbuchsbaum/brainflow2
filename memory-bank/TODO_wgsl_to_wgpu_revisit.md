# TODO: Revisit wgsl_to_wgpu for Build-Time Shader Compilation

**Date Created:** 2025-01-24
**Priority:** Low (Post-MVP)
**Category:** Performance Optimization

## Background

We previously disabled `wgsl_to_wgpu` build-time shader compilation due to perceived incompatibility with wgpu 0.25. However, it appears this may have been resolved.

## Discovery

The `wgsl_to_wgpu` repository now shows compatibility with wgpu 25.0.0:
- Repository: https://github.com/ScanMountGoat/wgsl_to_wgpu
- Example using wgpu 25.0.0: https://github.com/ScanMountGoat/wgsl_to_wgpu/blob/main/example/Cargo.toml

## Current State

We're currently using runtime shader loading which:
- ✅ Works well for development (hot-reload capability)
- ✅ No blocking issues
- ❓ May have slight performance overhead at startup
- ❓ Lacks compile-time validation of shader code

## Benefits of Revisiting

1. **Compile-time validation**: Catch shader errors during build
2. **Type safety**: Generated Rust types for shader interfaces
3. **Potential performance**: No runtime compilation overhead
4. **Better IDE support**: Type hints for shader bindings

## Implementation Plan (When Ready)

1. Add `wgsl_to_wgpu` to build dependencies

## Known Issues (2025-10-28)
- Slice shader colormap binding dimension: In our trial on the current stack (wgpu 0.20.x), the generated typed layout for the optimized slice shader sets binding 16 (colormap LUT) to `D2` even though the WGSL declares `texture_2d_array<f32>`. This caused a validation error when providing a `D2Array` view. Workaround in place: under `render_loop/typed-shaders`, we construct the texture bind group (group 2) manually with `D2Array` for the LUT while keeping typed buffers for groups 0/1. Track an upstream fix in wgsl_to_wgpu and remove the manual path when resolved.
2. Update `build.rs` to compile shaders
3. Keep runtime loading as fallback for development
4. Benchmark startup time difference
5. Ensure hot-reload still works in dev mode

## Decision Criteria

Only proceed if:
- MVP is complete and stable
- Performance profiling shows shader compilation is a bottleneck
- The benefits outweigh the implementation effort
- It doesn't break the development hot-reload workflow

## References

- Original issue: CD-001 in Technical_Debt_Register.md
- Current implementation: core/render_loop/build.rs
- Runtime shader loading: core/render_loop/src/shaders.rs
