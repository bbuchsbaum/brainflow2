<!-- Parent: ../AGENTS.md -->

# render_contracts

## Purpose
Transport-neutral rendering contracts for Brainflow renderers, bridges, and external visualization clients. This crate owns serializable view-state, layer, frame request, frame result, and render diagnostics types.

## Boundaries
- No Tauri, WGPU, or React/UI dependencies.
- Keep runtime GPU resources in `render_loop`.
- Keep Brainflow app orchestration, registries, leases, and event emission in `api_bridge`.
- Public frontend-visible types should derive `Serialize`, `Deserialize`, and `TS`.

## Testing
- Run `cargo test -p render_contracts` for serde round trips, validation, and TS export smoke tests.
- Run `cargo xtask ts-bindings` after changing exported types.

## Compatibility
`render_loop::view_state::*` and `render_loop::render_state::{BlendMode, LayerMode, ThresholdMode}` re-export these contracts for existing Brainflow call sites. Prefer importing this crate directly from new reusable code.
