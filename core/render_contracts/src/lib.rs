//! Transport-neutral rendering contracts shared by renderers, bridges, and clients.
//!
//! This crate intentionally has no Tauri, React, or WGPU dependency. Runtime GPU
//! resources stay in `render_loop`; this crate owns only serializable request,
//! response, and display-state contracts.

pub mod view_state;

pub use view_state::*;
