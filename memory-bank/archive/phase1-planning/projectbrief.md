# Brainflow — Project Brief

**Version:** 1.1 (Phase 1 - WebGPU v2)
**Date:** June 25, 2024
**Status:** Active Development (Sprint 1 Complete / Starting Sprint 2)

## 1. Core Goal

Brainflow aims to be a **high-performance, cross-platform desktop application** for neuroimaging visualization and analysis, built using **Tauri (Rust backend) and Svelte (TypeScript frontend with WebGPU for 2D rendering)**.

Key objectives include: Fast Loading & Interaction, Advanced Layering (GPU-based), Integrated Views & Plotting, Extensibility (Plugins), and Future-Proofing (path to pure-web).

## 2. Phase 1 Scope

Deliver an MVP demonstrating core architecture: Load NIfTI/GIfTI, Orthogonal Slice View (WebGPU), 3D Surface View (Three.js/WebGL), Basic Layer Management, Atlas Overlays & Legend, Click-to-Timeseries Plotting (Plotly Worker). Functional on macOS, Windows, Linux.

*(Out of Scope P1: Volume Rendering, ROI editing, complex stats, full web deploy).*

## 3. AI Assistant Guidance (`Hint`)

> **AI Hint:**
> *   **Focus:** Rust core (`core/`), TS UI (`ui/`), TS Plugins (`plugins/`). Use `@brainflow/api`.
> *   **Performance:** Zero-copy SABs/Buffers via Tauri bridge.
> *   **Rendering:** Defer to `RenderLoopService` (Rust/wgpu) for slices via `world_to_voxel` matrix (`ADR-002`). Surfaces use Three.js/WebGL (P1). No JS pixel math for volumes.
> *   **Coordinates:** Canonical space is LPI world mm. Use `CoordinateEngine` (Rust).
> *   **State:** Zustand immutable slices.
> *   **Errors:** Rust `Result` -> TS Promise rejection (`ADR-001`).
> *   **Tests:** Prioritize Rust unit -> TS component -> E2E. Benchmarks (`cargo bench`) validate performance gates.
> *   **Docs:** **Follow references herein to detailed specs in `/memory-bank` when needed.**

---
**Further Reading (Core Plans):**
*   `memory-bank/PLAN-phase1-milestones.md` (Detailed Goals & DoD)
*   *(Optional: See full index at `memory-bank/docIndex.md` if maintained)* 