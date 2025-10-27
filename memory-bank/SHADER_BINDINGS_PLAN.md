# Plan: Safe Trial of wgsl_to_wgpu (Typed Shader Bindings)

Objective
- Evaluate reintroducing build-time typed shader bindings with `wgsl_to_wgpu`, without risking current runtime shader path.

Status (2025-10-28)
- ✅ T-020 compatibility sweep confirms `wgsl_to_wgpu 0.8.0` aligns with the pinned `wgpu 0.20.1 / naga 0.20.1` stack.
- ✅ T-021/T-022 scaffolding in place: `render_loop` exposes a `typed-shaders` feature, build.rs now emits generated bindings for the slice shaders, and `shaders.rs` includes them behind the flag.
- ✅ T-023 (phase 1): typed modules are registered via `ShaderManager` when the feature is enabled, keeping the runtime loader as the default path; `cargo check -p render_loop --features typed-shaders` passes.
- ✅ Typed path now prefers the optimized slice shader: bind-group helpers are sourced from the generated module (including the nearest-neighbour sampler), `RenderLoopService` routes world-space renders through `slice_world_space_optimized`, and both execution modes are green (`cargo check -p render_loop`, `cargo check -p render_loop --features typed-shaders`, `cargo test -p render_loop --features typed-shaders --test typed_shaders_smoke`).
- 🚧 T-023–T-026 remaining: refactor render pipeline to consume the new facade end-to-end (bind group wiring + override constants), stand up a feature-gated CI leg (`cargo check -p render_loop --features typed-shaders`), and benchmark typed vs runtime paths before any default flip.

Guardrails
- Feature-gated: default build uses runtime WGSL. Typed path enabled via `render_loop` feature `typed-shaders`.
- Separate CI job to build and test feature path; no change to default release pipeline until approved.
- Git rollback: work on `feature/wgsl-bindings-trial`; tag baseline prior to experiment.

Typed shader CI check
- Workflow `.github/workflows/typed-shader-check.yml` executes on push/PR (main/develop) and runs `./tools/run-typed-shader-check.sh`.
- Script: `tools/run-typed-shader-check.sh` runs the two commands we expect to wire into CI:
  1. `cargo check -p render_loop --features typed-shaders`
  2. `cargo test -p render_loop --features typed-shaders --test typed_shaders_smoke`
- Usage: `./tools/run-typed-shader-check.sh` (from repo root or any path).
- CI todo: consider consolidating with existing Rust workflows once the trial graduates from feature-flag status.

Benchmark blueprint (T-026 prep)
- Goal: compare runtime vs typed shader paths for upload cost and render latency.
- Suggested workloads:
  1. **Upload/memory** – existing Criterion bench `upload.rs`.
     - Runtime path: `cargo bench -p render_loop --bench upload`
     - Typed path: `cargo bench -p render_loop --bench upload --features typed-shaders`
     - Capture `criterion` output for throughput comparison.
  2. **Render hot loop** – leverage the diagnostic binaries under `core/render_loop/src/bin`.
     - Example command (runtime): `cargo run -p render_loop --bin test_mni_slices --release`
     - Typed path: `cargo run -p render_loop --bin test_mni_slices --release --features typed-shaders`
     - Use `hyperfine` (if available) to gather wall-clock times:
       ```
       hyperfine \
         'cargo run -p render_loop --bin test_mni_slices --release' \
         'cargo run -p render_loop --bin test_mni_slices --release --features typed-shaders'
       ```
     - Inputs: the existing MNI volume fixtures under `test-data/` provide a consistent dataset; ensure GPU cache is warm (run each command once before timing).
- Record results (throughput, render time deltas, GPU memory stats) in this document before deciding on default rollout.
- Current blockers (resolved/updated):
  - Dev binaries are gated; benches run from `core/render_loop_benches` to avoid dev-dep collisions.
  - Typed render-time bench currently blocked by a texture-view dimension mismatch (see below).

Preliminary results (Upload throughput)
- Environment: WGPU 0.20, macOS (local dev machine), R32F 256x256x256 copy_buffer_to_texture, Criterion quick mode.
- Runtime path: time ≈ 469–475 µs; throughput ≈ 131–133 GiB/s.
- Typed path (render_loop/typed-shaders): time ≈ 476–484 µs; throughput ≈ 129–131 GiB/s.
- Interpretation: no meaningful difference in raw upload throughput (Criterion reported “No change in performance detected”).

Preliminary results (Render time)
- Environment: same as above; offscreen 512×512 RGBA target, Criterion quick mode.
- Runtime path: RenderFrame/request_frame_512_rgba ≈ 2.93–3.55 ms.
- Typed path: RenderFrame/request_frame_512_rgba ≈ 2.87–2.98 ms (slight improvement in this run).
- Fix applied: worked around a wgsl_to_wgpu layout bug by using a manual wgpu bind group for BindGroup(2) with a D2Array colormap view (matching WGSL’s `texture_2d_array<f32>`). The generated layout had `D2` for binding 16; we now bypass it for textures under the `typed-shaders` feature while keeping typed buffers for groups 0/1.
- Follow‑up: Upstream an issue to wgsl_to_wgpu about array texture view_dimension for `texture_2d_array<f32>`; keep our manual layout until a fix lands.

Steps
- Compatibility sweep (T-020)
  - Identify versions: `wgpu`, `naga`, and `wgsl_to_wgpu` that co-exist with current workspace pins.
  - Prefer no change to global `wgpu` pin; if upgrade required, do it only on a trial branch and only for `render_loop` first.
  - Findings (2025-10-28):
    - Workspace pins today: `wgpu 0.20.1`, `wgpu-types 0.20.0`, `naga 0.20.1`.
    - `wgsl_to_wgpu 0.8.0` targets the same stack (`wgpu-types 0.20.0`, `naga 0.20.0`) and is the latest release that aligns without bumping the renderer.
    - Later crate releases (≥0.9) jump to `wgpu-types 0.22+` and would force a full graphics upgrade; keep them out of scope for this sprint.

- Crate setup (T-021/T-022)
  - `render_loop/Cargo.toml`
    - Add `[features] typed-shaders = []`.
    - Add `[build-dependencies] wgsl_to_wgpu = "x.y.z"` (exact version after T-020).
  - `render_loop/build.rs` (activated only if `typed-shaders` is enabled via `cfg!(feature = "typed-shaders")`):
    - Read WGSL sources (e.g., `src/shaders/slice_world_space.wgsl`).
    - Call `wgsl_to_wgpu::create_shader_module_embedded` and write to `OUT_DIR` as `slice_world_space.rs`.
    - Print `cargo:rerun-if-changed=...` for each WGSL file.

- Conditional wiring (T-023)
  - In `src/shaders.rs`, create a `mod generated` with `include!(concat!(env!("OUT_DIR"), "/slice_world_space.rs"));` guarded by `#[cfg(feature = "typed-shaders")]`.
  - Provide a small adapter to align generated types with our existing `ShaderManager`/pipeline code paths (so the rest of the renderer doesn’t change).
    - ✅ `SliceShaderDescriptors` facade + unit test (`core/render_loop/src/shaders.rs`) expose entry-points/targets for both runtime and typed paths; pipeline manager now has `get_or_create_slice_pipeline`.
    - ❗️Next: Teach the facade to own the generated bind-group helpers so we can remove the hand-rolled layouts once the typed path is default.

- Layout safety (T-024)
  - Enable derives `bytemuck` or `encase` for generated UBO/storage structs.
  - Turn on const layout checks to catch vec3/mat3 pitfalls; migrate to vec4/mat4 where required.

- CI and benchmarks (T-025/T-026)
  - Add CI job: `cargo build -p render_loop --features typed-shaders` + `cargo test`.
  - Compare init latency and frame time on toy and mid-size volumes.
  - Manual verification for now: `cargo check -p render_loop --features typed-shaders` (runtime path stays default).
  - Added smoke test: `cargo test -p render_loop --features typed-shaders --test typed_shaders_smoke`.

- Decision gate
  - Go/No-Go criteria: build stability, type-safety value (compile-time errors for WGSL changes), perf parity (<=2% init/frame regressions), and developer experience.

Fallbacks
- If the trial fails to compile or introduces regressions, keep feature disabled; no changes to default path.
- If partial success, restrict typed path to a subset of shaders (e.g., uniform-only modules) while keeping others runtime-loaded.

Notes
- Keep shader sources canonical under `core/render_loop/src/shaders/*.wgsl`.
- Avoid touching pipeline state layout unless necessary; the goal is to replace boilerplate, not the runtime model.
