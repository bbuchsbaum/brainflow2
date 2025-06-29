# Brainflow 🧠

**High-performance, cross-platform desktop application for neuroimaging visualization and analysis.**

Built using **Tauri (Rust backend)** and **Svelte (TypeScript frontend with WebGPU for 2D rendering)**.

**Current Status:** Phase 1 (WebGPU v2) - Sprint 1 Complete / Starting Sprint 2 (M4 Kickoff)

## Key Goals (Phase 1)

*   Load NIfTI/GIfTI data.
*   Display interactive Orthogonal Slice Views (WebGPU).
*   Display 3D Surface Views (Three.js/WebGL).
*   Basic Layer Management & Atlas Overlays.
*   Click-to-Timeseries Plotting (Plotly Worker).
*   Functional on macOS, Windows, Linux.

## Documentation

*   **Project Brief:** `memory-bank/projectbrief.md`
*   **Architecture:** `memory-bank/ADR-001-architecture.md`
*   **Phase 1 Plan:** `memory-bank/PLAN-phase1-milestones.md`
*   **UI Layout Guide:** `memory-bank/GUIDE-ui-layout-phase1.md`
*   **Repository Structure:** `memory-bank/repository_structure.md`
*   **Full Bootstrap Guide:** `memory-bank/DEV-bootstrap-guide.md`

## Quick Start / Setup

Follow the platform-specific dependency instructions from the [Tauri prerequisites guide](https://tauri.app/v1/guides/getting-started/prerequisites) first.

**Core Requirements:**

1.  **Rust Toolchain (Stable):**
    *   Install via [rustup.rs](https://rustup.rs/).
    *   Add WASM target: `rustup target add wasm32-unknown-unknown`
    *   Ensure `clippy` and `rustfmt` are installed: `rustup component add clippy rustfmt`
    *   *(Windows)*: Install LLVM/Clang and ensure it's in your PATH.

2.  **Node.js (>= v20) + pnpm:**
    *   Enable `corepack`: `corepack enable`
    *   Activate latest `pnpm`: `corepack prepare pnpm@latest --activate`

3.  **Tauri CLI:**
    *   Install: `cargo install tauri-cli --locked`

**Repository Setup:**

```bash
# Clone the repository (replace with actual repo URL)
# git clone <repository-url>
# cd brainflow

# Install Rust dependencies (downloads crates)
cargo fetch 

# Install Node.js dependencies
pnpm install

# Build the shared API package
cd packages/api
pnpm run build
cd ../.. 
```

## Development

```bash
# Run the Tauri application in development mode (with hot-reloading)
cargo tauri dev

# Run Rust tests
cargo test --workspace

# Run UI unit tests
pnpm --filter ui test:unit

# Run E2E tests (requires UI dev server running, see playwright.config.ts)
pnpm --filter ui test:e2e

# Run Texture Upload Benchmark
cargo bench -p render_loop --bench upload

# Build the application
cargo tauri build 
``` 