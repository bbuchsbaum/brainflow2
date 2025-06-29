
docs/ERRATA-phase1-v1.1.md

Version: 1.1
Status: Pending Action
Date: [Insert Date]
Context: This document lists identified inconsistencies, gaps, and necessary updates across the core Phase 1 planning and specification documents (ADR-001-architecture.md, ADR-002-multilayer-rendering.md, SPEC-json-schemas-v0.1.1.md, PLAN-migration-phase1.md, PLAN-phase1-milestones.md, GUIDE-ui-layout-phase1.md). It provides specific actions required to align these documents to the final approved "WebGPU v2" plan, including the DataFrame payload amendment and other clarifications, ensuring a consistent starting point for development.

Inconsistencies and Required Updates

E-01: Component Naming (Render Loop)

Issue: The Rust WebGPU rendering component is referred to variously as RenderLoop, RenderLoopService, gpu_upload_volume path context, WebGPU render thread.

Affected Documents:

ADR-001-architecture.md

ADR-002-multilayer-rendering.md

PLAN-migration-phase1.md

PLAN-phase1-milestones.md

Resolution: Use canonical names: render_loop for the Rust crate (core/render_loop/) and RenderLoopService for the primary Rust struct/service managing the wgpu loop and resources.

Required Actions:

File: docs/ADR-001-architecture.md

Update UML diagram: Rename class RenderLoop to RenderLoopService.

Update "Language / Ownership Recap" table if applicable.

File: docs/ADR-002-multilayer-rendering.md

Update Section 2 ("Data Loading & GPU Upload Path"): Refer to RenderLoopService where appropriate (e.g., Step 4).

Update Section 5.B ("world_to_voxel Matrix Calculation"): Mention calculation occurs within RenderLoopService.

File: docs/PLAN-migration-phase1.md

Ensure references align with RenderLoopService and the core/render_loop crate.

File: docs/PLAN-phase1-milestones.md

Ensure references align with RenderLoopService.

E-02: Core API Version and Naming Conventions

Issue: Discrepancies in API version (v0.1.0 vs. v0.1.1), inconsistent naming (camelCase vs. snake_case for API methods representing Tauri commands), and missing/inconsistent listing of core API methods across documents (e.g., getTimeseriesMatrix, requestLayerGpuResources).

Affected Documents:

ADR-001-architecture.md

SPEC-json-schemas-v0.1.1.md

ADR-002-multilayer-rendering.md

PLAN-migration-phase1.md

PLAN-phase1-milestones.md

GUIDE-ui-layout-phase1.md

Resolution: Standardize on API version 0.1.1. Use snake_case for all method names within the CoreApi TypeScript interface that directly map to Tauri commands. Ensure all core P1 API methods (loadFile, worldToVoxel, getTimeseriesMatrix, requestLayerGpuResources, etc. as defined in @brainflow/api) are consistently represented.

Required Actions:

File: docs/ADR-001-architecture.md

Update Version to 1.1.

Update CoreApi class diagram: Ensure all P1 methods are listed using snake_case (e.g., load_file(), get_timeseries_matrix(), request_layer_gpu_resources()).

Update "Language / Ownership Recap" table note regarding @brainflow/api@0.1.1.

Update Section 2 diagram note: Add DataSample, DataFrame model boxes with @brainflow/api stereotype.

File: docs/SPEC-json-schemas-v0.1.1.md

Verify all apiVersion fields are 0.1.1.

Update Title/Description to reflect v0.1.1 where applicable.

Update getTimeseriesMatrix Response Payload schema (Section 4) to include optional columns, colDtype, meta fields for DataFrame support. Add corresponding examples.

File: docs/ADR-002-multilayer-rendering.md

Update Version to 1.1.

Update Target API reference to @brainflow/api@0.1.1.

Update Core Types section (Section 1) to reference @brainflow/api@0.1.1.

Update Section 6 (TypeScript Orchestration) example: Change coreApi.uploadVolume to coreApi.request_layer_gpu_resources (or equivalent final snake_case name).

Update Section 7 (Error Handling Contract) example: Change coreApi.uploadVolume to coreApi.request_layer_gpu_resources.

Add Section 9 ("Relation to Data APIs") mentioning get_timeseries_matrix and DataFrame.

File: docs/PLAN-migration-phase1.md

Update Version reference to v1.1 / @brainflow/api@0.1.1.

Ensure API method names used in descriptions are snake_case.

File: docs/PLAN-phase1-milestones.md

Update Version reference to v1.1 / @brainflow/api@0.1.1.

File: docs/GUIDE-ui-layout-phase1.md

Update API method names in examples/descriptions to snake_case (e.g., coreApi.save_config, coreApi.release_view_resources, coreApi.load_file).

Update Section 5.2 (Component State Hygiene) example: Use coreApi.load_file or similar.

E-03: Plugin Manifest handles Field Description

Issue: The handles field in brainflow-plugin.json allows different types of strings, but the schema lacks a clear description of this.

Affected Documents:

SPEC-json-schemas-v0.1.1.md

Resolution: Add a descriptive description field to the handles property in the JSON schema.

Required Actions:

File: docs/SPEC-json-schemas-v0.1.1.md

Update the description for the handles property in the brainflow-plugin.json schema (Section 1) to clarify allowed string types (patterns, MIME types, data type IDs).

E-04: GPU Texture Format Specification

Issue: Conflicting information regarding the default texture format used for volume atlases (RGBA8Unorm vs. .r sampling vs. R16Float recommendation).

Affected Documents:

ADR-002-multilayer-rendering.md

Resolution: Standardize on the policy defined in the Multilayer Spec Addendum (Section A/5.A): Default to R16Float, use R32Float for high-range floats, R8Unorm for bytes. RGBA8Unorm is reserved. Add texFormat to VolumeLayerGPU type.

Required Actions:

File: docs/ADR-002-multilayer-rendering.md

Ensure Section 1 (Core Types) includes texFormat: GpuTextureFormat in VolumeLayerGPU.

Ensure Section 3.B (Volume Texture Atlas) reflects the R16Float default and describes the format selection policy.

Ensure Section 4 (Shader Contract) notes that sampling logic might need to adapt based on texFormat (e.g., sampling .r for single-channel formats).

Ensure Section 5.A (Voxel Data Type to GPU Texture Format Policy) accurately reflects the final policy table.

E-05: GIfTI Loader Port Task Timing

Issue: The migration plan's task list (PLAN-migration-phase1.md) omitted the explicit GIfTI loader port task, while other documents rely on it for M4.

Affected Documents:

PLAN-migration-phase1.md

PLAN-phase1-milestones.md

Resolution: Add task S4-b for porting the GIfTI loader to Rust, targeting Milestone M4.

Required Actions:

File: docs/PLAN-migration-phase1.md

Update the Migration Steps table (Section 4) to include task S4-b "Port GIfTI Loader to Rust (core::loaders::gifti), returns Surface w/ SAB", targeted for M4. Adjust subsequent step numbering/timing if needed.

File: docs/PLAN-phase1-milestones.md

Ensure M4 tasks explicitly mention implementing the gifti-loader Rust plugin.

E-06: Milestone Timeline Harmonization (M3)

Issue: Different estimated durations mentioned for M3 (WebGPU setup + slice porting).

Affected Documents:

PLAN-phase1-milestones.md

Resolution: Standardize on the 11-day estimate for M3 as per the latest agreement reflecting complexity and buffer time.

Required Actions:

File: docs/PLAN-phase1-milestones.md

Update the estimated duration for M3 to (Est. 11 days).

E-07: Error Handling Documentation

Issue: Error handling conventions were defined in the multilayer spec addendum but missing from the main architecture document.

Affected Documents:

ADR-001-architecture.md

Resolution: Add a dedicated section outlining the error handling approach (Rust Result, serializable error enums, TS .catch() blocks).

Required Actions:

File: docs/ADR-001-architecture.md

Add Section 3 ("Error Handling Conventions") detailing the strategy.

E-08: Component State Persistence & Restoration

Issue: The UI guide described state persistence via container.setState but didn't explicitly mandate how components should handle restoration on mount.

Affected Documents:

GUIDE-ui-layout-phase1.md

Resolution: Add explicit requirement in the "Component State Hygiene" section for components to read container.getState() on mount and rehydrate.

Required Actions:

File: docs/GUIDE-ui-layout-phase1.md

Update Section 5.2 (Component State Hygiene) to clearly state the requirement for components to read container.getState() on mount/construction and restore their state.

E-09: API for Resource Release Failure

Issue: The UI guide proposed a best-effort releaseViewResources call but didn't specify how the API should report potential (non-critical) failures.

Affected Documents:

ADR-001-architecture.md (Implied in CoreApi)

GUIDE-ui-layout-phase1.md

Resolution: Define the Core API method as potentially returning status information (e.g., Promise<{ok: boolean; reason?: string}>) to allow the retry queue logic.

Required Actions:

File: docs/ADR-001-architecture.md

Update the CoreApi diagram/listing to include release_view_resources(id: string): Promise<{ok: boolean; reason?: string}> (or similar agreed signature).

File: docs/GUIDE-ui-layout-phase1.md

Update the example call in Section 5.1 (glRegister) to reflect the potential return value and adjust the .catch block example if necessary.

Next Steps

Apply the "Required Actions" listed above to each specified document.

Verify the changes address all points in this errata.

Commit the updated documents, establishing the synchronized v1.1 baseline for Phase 1 development.