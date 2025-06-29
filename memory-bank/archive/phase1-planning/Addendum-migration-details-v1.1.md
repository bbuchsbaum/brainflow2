docs/ADDENDUM-migration-details-v1.1.md
Version: 1.1
Status: Adopted
Date: [Insert Date]
Context: This document provides detailed implementation specifics for the Phase 1 Legacy Code Migration Plan (docs/PLAN-migration-phase1.md), refining the scope of Rust ports, clarifying legacy code integration, specifying dependencies, and detailing the adapter testing strategy based on "Migration Plan - Revision B". It aligns with the Brainflow Phase 1 Architecture Plan (WebGPU v2) and @brainflow/api@0.1.1.
1. Revised Scope of Rust Ports (Phase 1)
Following the "Port-what-hurts" principle and focusing on necessities for the WebGPU rendering path and core API functionality, the scope for porting TypeScript code to Rust in Phase 1 is strictly limited to:
crates/volmath:
space.rs: Port essential NeuroSpace functionality:
Constructor (new)
Core properties access (dim, spacing, affine, inverse_affine)
Core coordinate transforms (grid_to_coord, coord_to_grid)
Associated Axis and NamedAxis types/constants.
volume.rs:
Minimal read-only accessors for dense volumes, likely integrated into helpers used by RenderLoopService and api_bridge. Focus on:
get_voxel(i, j, k) equivalent.
get_slice(z, orientation) equivalent logic to extract raw data for GPU upload.
A basic internal struct (e.g., VolumeViewData) holding dimensions, strides, and a reference to the data buffer (&[T]) sufficient for these accessors.
accel.rs:
KD-Tree implementation (using kiddo crate) for worldToSurfaceVertex lookup.
crates/core/loaders/:
nifti.rs: Full port of NIfTI-1 parsing using the Rust nifti crate. Must handle .nii and .nii.gz, extract header/affine, and return voxel data in a Volume structure via SAB/ArrayBuffer.
gifti.rs: Full port of GIfTI geometry loading using the Rust gifti crate. Must return Surface structure with vertices/indices via SAB/ArrayBuffer.
Deferred to Phase 2 (or later):
Full DenseNeuroVol, NeuroSlice, NeuroVec, SparseNeuroVol class ports with mutating methods and complex operations.
Resampler.ts logic.
ClusterVol.ts, ConnectedComponents.ts, snic.ts.
Complex ROI generation/manipulation logic (beyond basic structures if needed for matrix API).
2. Legacy TypeScript Integration (Phase 1)
Modules kept in TypeScript reside in packages/legacy-ts and are accessed as follows:
Atlas Logic (NeuroAtlas.ts, TemplateFlow.ts):
These are not called directly by Rust.
The atlas-loader TypeScript plugin (in plugins/atlas-loader/) will import and use these classes.
This plugin implements the LoaderPlugin interface from @brainflow/api.
Its load function will call NeuroAtlas.loadSchaeferAtlas (or similar), then marshal the resulting data (ClusteredNeuroVol, labels, colors) into the standard AtlasLayer structure defined in @brainflow/api, requesting SAB allocation via coreApi calls if needed for large data before returning the AtlasLayer object.
Colormap Generation (ColorMap.ts):
The Svelte UI components (e.g., LayerPanel.svelte) will import ColorMap from @brainflow/legacy-ts.
When a user selects a colormap, the TS code will use ColorMap.fromPreset(name) and potentially methods like getColorMap() to generate the 256-entry RGB(A) color data.
This data (e.g., as a Uint8Array or similar) will then be passed to a new Rust Tauri command (e.g., register_colormap(name, lut_data)) which handles uploading/updating the GPU LUT texture array (as specified in ADR-002).
Dropped legacy_bridge: No runtime WASM bridge from Rust to call legacy TS utilities is required for Phase 1.
3. Rust Crate Dependencies (Key Additions for Ports)
The following key external Rust crates will be necessary for the ported modules:
nalgebra: For efficient, statically-typed linear algebra (vectors, matrices) needed in volmath (replacing ml-matrix).
nifti: For parsing NIfTI-1 headers and data in core/loaders/nifti.
gifti: For parsing GIfTI surface geometry in core/loaders/gifti.
serde (+ serde_json): For serialization/deserialization (Tauri commands, error types, potentially plugin manifests if handled in Rust).
ts-rs: For generating TypeScript type definitions (.d.ts) from Rust structs/enums to keep @brainflow/api in sync with Rust implementation details where needed (e.g., error enums, potentially internal helper types if exposed).
thiserror: For idiomatic Rust error handling and deriving std::error::Error implementations.
wgpu: Core GPU abstraction library used by core/render_loop.
rayon: For parallel processing, primarily for KD-tree building (volmath::accel) and potentially large data processing during load.
kiddo: KD-tree implementation for spatial lookups in volmath::accel.
wasm-bindgen / wasm-bindgen-test / wasm-pack: Used only in the testing context for building Rust code to WASM and running adapter tests comparing against legacy TS. Not included in production builds.
criterion: For Rust performance benchmarking during development and potentially in CI smoke tests.
4. Adapter Testing Strategy
To ensure numerical fidelity during the porting process:
Setup: A dedicated test suite within the crates/volmath crate (e.g., tests/adapter_tests.rs) will be configured using #[wasm_bindgen_test].
Build: wasm-pack test --node -- --package volmath will compile the relevant Rust functions to WASM for Node.js execution.
Execution: A JavaScript/TypeScript test runner (Vitest/Jest configured in the root or packages/legacy-ts) will:
Import the compiled WASM module from volmath.
Import the corresponding legacy TS module from @brainflow/legacy-ts.
Define a set of "golden" test cases (inputs).
For each test case, call both the Rust-via-WASM function and the legacy TS function with the same input.
Compare the outputs. For floating-point results, use an appropriate tolerance (expect(...).toBeCloseTo(...)). For complex objects or arrays, use snapshot testing or deep equality checks.
CI Integration: The wasm-pack test command and the JS adapter test suite will be added as steps in the CI workflow (.github/workflows/ci.yml), running on every Pull Request that modifies crates/volmath or packages/legacy-ts.
5. Revised Migration Steps & Timeline (Summary Grid)
(Reflects minimal volmath scope, explicit GIfTI port, and adjusted timings)
Step	Task	Target Milestone	Est. Time	Owner	Status
S0	Create packages/legacy-ts, copy target TS files, lint/build check.	M1 End	0.5 d	engineer-TS	Done in M1
S1	Export NeuroAtlas, ColorMap from legacy-ts/index.ts.	M1 End	0.5 d	engineer-TS	Done in M1
S2	Implement atlas-loader plugin (TS) wrapping NeuroAtlas.	M7	1 d	engineer-TS	Pending M7
S3-a	Port minimal NeuroSpace/Axis/Volume struct to volmath (Rust).	M2	2 d	engineer-Rust	Active M2
S3-b	Implement Adapter Test Harness & NeuroSpace golden test.	M2	1 d	engineer-Rust	Active M2
S4-a	Port NIfTI Loader to Rust (core::loaders::nifti), returns Volume w/ SAB.	M3	1 d	engineer-Rust	Pending M3
S4-b	Port GIfTI Loader to Rust (core::loaders::gifti), returns Surface w/ SAB.	M4	1 d	engineer-Rust	Pending M4
S4-c	Integrate NIfTI/GIfTI loaders into Rust LoaderRegistry.	M4	0.5 d	engineer-Rust	Pending M4
S4-d	Port essential slice/voxel access to volmath (Rust).	M3	1.5 d	engineer-Rust	Pending M3
S5	Remove Pixi imports; VolumeView uses requestLayerGpuResources.	M3 End	0.5 d	build-lead	Pending M3
S6	GPU RenderLoopService uses volmath::get_slice outputs for texture uploads.	M3	(part of M3)	engineer-Rust	Pending M3
S7	Replace TS ColorMap.getColorArray with GPU LUT upload via Rust command.	M7	0.5 d	engineer-TS	Pending M7
S8	Archive deprecated TS folders; create cleanup tickets.	M8	0.5 d	team-lead	Pending M8
Contingency	Buffer for wgpu / driver / porting issues.	M3/M4	1 d	team	Available
6. Build & CI Implications
TypeScript code (UI, plugins) will need tsconfig.json paths configured to resolve @brainflow/api and @brainflow/legacy-ts.
The root Cargo.toml must list volmath in its workspace members.
CI pipeline (ci.yml) must include steps for:
Building the legacy-ts package (pnpm --filter @brainflow/legacy-ts build).
Running Rust unit tests (cargo test --workspace).
Running adapter tests (wasm-pack test --node -- --package volmath followed by pnpm test:adapter).
7. Summary
This refined migration strategy prioritizes porting the absolute necessities for the Phase 1 WebGPU rendering path and Core API to Rust (NeuroSpace essentials, I/O loaders, basic volume accessors, KD-tree). It leverages existing TS code for atlas handling and colormap generation via well-defined interfaces (plugins, Tauri commands). The adapter testing framework ensures numerical correctness during the transition. This approach minimizes upfront Rust porting effort while meeting the performance and architectural goals of Phase 1.