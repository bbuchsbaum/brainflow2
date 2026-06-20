# Render Contract Migration Notes

`render_contracts` is the neutral boundary for serializable renderer-facing state. New reusable renderer, bridge, TypeScript client, and React viewer work should depend on this crate or on the generated TypeScript files from `packages/api/src/generated`.

## Downstream Modularization Items

- Modularization 2, WGPU slice renderer facade: use `ViewState`, `LayerConfig`, `FrameRequestOptions`, `FrameResult`, and diagnostics from this crate. `render_loop::WgpuSliceRenderer` is the reusable lifecycle facade over the runtime WGSL path; keep `wgpu` device, queue, textures, buffers, pipelines, and `ViewContext` inside `render_loop` or behind explicit compatibility adapters.
- Modularization 3, Tauri render bridge adapter: keep Brainflow registries, leases, atlas pressure events, permission mapping, Tauri commands, and frontend payload translation in `api_bridge`. Convert adapter inputs into these contracts before calling the renderer.
- Modularization 4, TypeScript render client: consume the generated contract files from `packages/api/src/generated`; do not hand-maintain duplicate request/result shapes.
- Modularization 5 and 6, React slice/surface viewers: accept contract-shaped render state or generated TS types at component boundaries, while keeping Zustand, GoldenLayout, and app-specific scheduling in Brainflow adapters.

## Compatibility

Existing Brainflow imports continue to work through:

- `render_loop::view_state::*`
- `render_loop::render_state::{BlendMode, LayerMode, ThresholdMode}`

Prefer importing `render_contracts` directly in new reusable Rust code.

`RenderLoopService` remains the Brainflow compatibility backend while command
bridges and older tests migrate. New external consumers should prefer
`render_loop::WgpuSliceRenderer` and `WgpuSliceRendererConfig` so they can
configure adapter, device limits, texture capacity, and atlas dimensions without
touching raw WGPU resources. The runtime masked shader still fixes the minimum
multi-texture binding count, so lower facade texture-capacity settings are
clamped until shader bindings become configurable.
