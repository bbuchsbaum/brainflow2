docs/PLAN-phase1-milestones.md
(Updated API version, Added DataFrame context to M6 task)
# Brainflow Phase 1 Development Milestones (WebGPU v2)

**Version:** 1.1 (Aligned with WebGPU v2 Architecture Plan & API v0.1.1)
**Status:** Approved for Implementation

## Overview

Outline of key milestones for Phase 1, delivering a cross-platform viewer using Tauri/Rust/Svelte/WebGPU.

---

### **M1: Foundation, Scaffolding & API v0.1.1 (Est. 4 days)**

*   **Goal:** Establish project structure, UI shell, CI, state management, publish API contract v0.1.1.
*   **Tasks:** Init workspace, Dockview layout, Zustand setup, Testing setup, CI/Linting, Plugin manifest schema v0.1.1, Define & Publish `@brainflow/api@0.1.1`, Resize bus, Verifier structure.
*   **DoD:** Repo structure complete; UI shell runs; API package v0.1.1 published; CI runs; Plugin manifest schema defined; Resize bus implemented; Verifier parses manifest.

---

### **M2: Core Rust Services & Bridge API v0.1.1 (Est. 6 days)**

*   **Goal:** Implement core Rust services, Tauri bindings, bridge helpers, basic BIDS scanning, minimal `volmath`.
*   **Tasks:** Define Rust traits, Implement Tauri commands matching API v0.1.1, Add `getTimeseriesMatrix` stub, Setup `ts-rs`, Implement `bridge.rs`, Implement `FileSystem` BIDS (P1 scope), Implement basic `CoordinateEngine` & minimal `volmath::NeuroSpace`, Implement verifier manifest validation, Add `supportsWebGPU()` check, Implement `NeuroSpace` adapter test harness.
*   **DoD:** Core Rust services compile; Commands match API v0.1.1; Bridge helpers exist; BIDS P1 scope met; Plugin verifier checks manifest; WebGPU check exists; Adapter test harness setup.

---

### **M3: Volume Loading & WebGPU Slice Display (Est. 11 days)**

*   **Goal:** Load NIfTI files and render slices using Rust `wgpu` render loop.
*   **Tasks:** Implement `nifti-loader` Rust plugin (v0.1.1), Integrate `wgpu`, Setup Rust render loop & device loss handling, Implement GPU resource bridge functions, Setup WGSL build, Implement `VolumeView.svelte` (WebGPU), Implement slice texture atlas packing/upload, Implement pan/zoom, Implement GPU texture cache, Wire load->render path, Add Playwright smoke test, Document drivers, Port slice/voxel access to `volmath`, Remove Pixi deps.
*   **DoD:** NIfTI loads & displays (WebGPU); Pan/zoom works; Smoke test passes; Texture atlas/cache implemented; Device loss handled; Slice math ported.
*   **Perf Gate:** Scroll 256-slice T1w >= 60 fps; CPU frame < 4ms; Texture upload > 2 GB/s.

---

### **M4: Surface Loading & 3D Display (Est. 5 days)**

*   **Goal:** Load GIfTI surfaces (Three.js/WebGL) alongside WebGPU view.
*   **Tasks:** Implement `gifti-loader` Rust plugin (v0.1.1), Integrate loaders into `LoaderRegistry`, Implement `SurfaceView.svelte`, Ensure canvas compositing/resizing, Wire load path, Spike atlas hover shader, Test outline viability.
*   **DoD:** GIfTI surfaces load & display; Rotation works; Hover shader spike done; Compositing stable.
*   **Perf Gate:** Rotate fsaverage >= 90 fps (M1/M2) / >= 60 fps (Win/RTX2060).

---

### **M5: Plotting Infrastructure & Basic Plot (Est. 4 days)**

*   **Goal:** Setup off-thread Plotly plotting.
*   **Tasks:** Implement `PlotPanel.svelte`, Setup Plotly Worker (mount once, use `Plotly.react`), Implement `plot-voxel-histogram` TS plugin (v0.1.1), Verify OffscreenCanvas rendering & data transfer.
*   **DoD:** Histogram plot appears; Worker stable.
*   **Perf Gate:** Data transfer >= 200 MB/s.

---

### **M6: Core Interaction Loop (Click -> Plot & Matrix) (Est. 6 days)**

*   **Goal:** Enable click-to-plot workflow and implement matrix data extraction backend.
*   **Tasks:** Implement click handling (WebGPU/Three.js) -> `PICK_WORLD_COORD`, Wire pick -> `worldToVoxel`, Implement `vol2surf.rs` (KD-tree, `u64` handle), Implement `getTimeseries`, **Implement Rust `getTimeseriesMatrix` (handles `TimeSeriesProvider` for optional DataFrame payload)**, Implement `CoordinateEngine::worldToVoxelBatch`, Implement `plot-voxel-ts` TS plugin (v0.1.1), Connect pick -> plot worker -> render, Implement `StatusBar.svelte`.
*   **DoD:** Click->plot works; Status bar updates; Matrix extraction implemented & unit tested (handles both simple TS and DataFrame).
*   **Perf Gates:** Click-to-plot < 50 ms. Matrix extraction (10k voxel ROI) < 120 ms (Rust benchmark).

---

### **M7: Atlas Integration & Legend UI (Est. 6 days)**

*   **Goal:** Load atlas layers, display overlays, implement interactive legend.
*   **Tasks:** Implement `atlas-loader` TS plugin (v0.1.1), Implement `AtlasLayer` rendering (`VolumeView`: texture mask; `SurfaceView`: shader/outline polish), Implement `LegendDrawer.svelte` (`svelte-virtual`), Populate/interact with legend, Implement viewer pick -> legend sync, Integrate `legacy-ts::ColorMap` for LUT upload.
*   **DoD:** Atlas overlays render; Legend displays/filters/virtualizes; Interactions work.
*   **Perf Gate:** Legend scroll >=60 fps (1k+ items). Atlas hover highlight no FPS drop.

---

### **M8: UI Polish & Final Integration (Est. 4 days)**

*   **Goal:** Refine UI, ensure stability, final testing, prepare builds.
*   **Tasks:** Refine `LayerPanel`, Ensure Dockview robustness, Apply themes, Integrate code signing, Final E2E testing, Build distributables, Archive deprecated TS code.
*   **DoD:** Application builds, installs, passes Phase 1 Acceptance Gate.

---