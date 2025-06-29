Okay, this sequence diagram and breakdown provide an excellent, concrete example of a core user workflow in Brainflow. It clarifies the interaction between components and highlights how the architecture supports responsiveness and extensibility.

Here's the formalized example guide, incorporating the discussion and adding context/clarifications:

---

# `docs/EXAMPLE-click-to-plot.md`

**Version:** 1.0
**Status:** Example Guide
**Date:** [Insert Date]
**Context:** This document illustrates the end-to-end data and control flow for the core "click-to-plot" interaction in Brainflow Phase 1. It serves as a practical guide for developers implementing related components (Viewers, State Management, Core API, Plotting) and demonstrates how the architectural patterns work together.

## 1. Scenario Overview

A user has loaded a 3D anatomical volume (e.g., T1w) and a 4D functional overlay (e.g., fMRI BOLD timeseries). They click on a voxel within one of the `VolumeView`'s orthogonal slices. The application should then fetch the corresponding timeseries data for that voxel from the 4D volume and display it in the `PlotPanel`.

## 2. Sequence Diagram

```mermaid
sequenceDiagram
    participant UI as Svelte UI (User Interaction)
    participant V as VolumeView (Svelte Component)
    participant ZS as Zustand Stores
    participant CA as CoreApi (TS Bridge Wrapper)
    participant TC as TauriCommands (Rust Backend)
    participant DS as DataService (Rust - incl. Loaders/TimeSeriesProvider)
    participant PW as PlotWorker (TS - OffscreenCanvas)
    participant PP as PlotPlugin (TS - e.g., Plotly)

    Note over UI, DS: Initial Load Phase (Simplified)
    UI ->> CA: load_file("T1w.nii.gz")
    CA ->> TC: invoke("load_file", { path: "..." })
    TC ->> DS: Access T1w data
    DS ->> TC: VolumeSendable Handle + Metadata
    TC -->> CA: handle_t1
    CA -->> ZS: layersSlice.addLayer({ handle: handle_t1, ... })
    UI ->> CA: load_file("bold.nii.gz") // Assume 4D
    CA ->> TC: invoke("load_file", ...)
    TC ->> DS: Access BOLD data (potentially lazy load header only)
    DS ->> TC: VolumeSendable Handle + Metadata (incl. 4D info)
    TC -->> CA: handle_bold
    CA -->> ZS: layersSlice.addLayer({ handle: handle_bold, ... })
    Note over V: Views subscribe to Zustand and render layers via RenderLoopService (omitted for clarity)

    Note over UI, PW: Click-to-Plot Interaction
    UI ->> V: User clicks on slice at screen coords (sx, sy)
    V ->> CA: world_to_voxel(volumeId: handle_t1, world: [wx, wy, wz]) // View converts screen->world first
    CA ->> TC: invoke("world_to_voxel", ...)
    TC -->> CA: { voxel: [vx, vy, vz] }
    V ->> ZS: viewerSlice.setPick({ world: [wx, wy, wz], voxel: [vx, vy, vz], voxelId: linearIndex }) // Update picked location

    Note right of ZS: PlotPanel subscribes to viewerSlice.pick

    PlotPanel ->> CA: get_timeseries_matrix({ sourceId: handle_bold, axis: "voxel", indices: [linearIndex], agg: "none" })
    CA ->> TC: invoke("get_timeseries_matrix", ...)
    TC ->> DS: request_matrix_at_voxel(ijk: [vx, vy, vz]) // Checks if DS implements TimeSeriesProvider
    DS ->> TC: MatrixPayload { data: SAB, shape: [1, T], dtype, columns?, meta? } // Reads/decodes data chunk
    TC -->> CA: ResponsePayload { data: SAB, shape, dtype, meta? }
    CA -->> PlotPanel: Promise resolves with payload

    PlotPanel ->> PW: postMessage({ type: "plot", payload: { targetId: "plot1", sample: DataSample(DataFrame), options: {...} } }, [SAB]) // Transfer SAB
    PW ->> PP: plugin = registry.get("timeseries"); plugin.render(canvas, payload.sample, ...)
    PP ->> Plotly: Plotly.react(canvas, data, layout)
    Note over PW, PP: Worker decodes SAB, uses Plotly on OffscreenCanvas

    Note over UI, PW: Plot Configuration Update
    UI -->> PlotPanel: User changes plot setting (e.g., detrend toggle)
    PlotPanel ->> ZS: plotsSlice.updateConfig("plot1", { detrend: true })
    PlotPanel ->> PW: postMessage({ type: "plot", payload: { targetId: "plot1", sample: /* cached sample? */, options: { detrend: true } } }) // Send re-render command with updated options
    PW ->> PP: plugin.render(canvas, sample, newOptions)
    PP ->> Plotly: Plotly.react(...)

```

## 3. Detailed Steps & Responsibilities

### 3.1 Load Phase (Simplified)

1.  **UI/Loader Trigger:** User action (drag/drop, +New Tab) results in calls to `coreApi.load_file` for the anatomical (`T1w.nii.gz`) and functional (`bold.nii.gz`) volumes.
2.  **Rust Backend:** `TauriCommands::load_file` invokes the appropriate Rust loader (`nifti-loader`).
3.  **Loader (`nifti.rs`):** Parses the header, determines dimensions and data type. For 4D data, it recognizes the time dimension. It allocates a `SharedArrayBuffer` (via Tauri bridge/JS context) and copies/maps the voxel data into it.
4.  **Return Value:** The loader returns a `VolumeSendable` struct (via `Result`) containing metadata (dims, affine, dtype, range) and a handle/reference to the SAB.
5.  **State Update:** The `CoreApi` wrapper resolves the promise, and the UI dispatches an action to `Zustand stores -> layersSlice` to add the new layer descriptions (including the SAB handle).
6.  **GPU Upload:** `VolumeView` reacts to the store change and calls `coreApi.request_layer_gpu_resources`, triggering the upload to the GPU Texture Atlas managed by `RenderLoopService` (as per `ADR-002`).

### 3.2 Attach Timeseries Data Source (Implicit in Load)

*   When the 4D `bold.nii.gz` is loaded (Step 1.3-1.4 above), the Rust backend (specifically the `nifti-loader` or a central `DataService`) should register this volume handle (`handle_bold`) as being a potential source of timeseries data. It might store metadata like dimensions (`[X,Y,Z,T]`), data type, and file path/offset information for efficient access later. No separate `attachTimeseries` API call is strictly needed if the loader handles this registration.

### 3.3 Click-to-Plot Pipeline

1.  **UI Pick Event:** User clicks within a `VolumeView` slice. The component calculates the corresponding LPI `worldCoord`.
2.  **Voxel Identification:** `VolumeView` calls `coreApi.world_to_voxel` (passing the `volumeId` of the *anatomical* layer, `handle_t1`, used for coordinate reference) to get the integer `voxelCoord` `[i,j,k]` and computes the `linearIndex`.
3.  **State Update:** `VolumeView` updates the `viewerSlice` in Zustand with the latest pick information (`{ world, voxel, voxelId }`).
4.  **Plot Panel Reaction:** `PlotPanel` subscribes to `viewerSlice.pick`. On change, it identifies the *active 4D volume* (e.g., `handle_bold` from `layersSlice`) and determines if plotting is appropriate.
5.  **Data Request:** `PlotPanel` calls `coreApi.get_timeseries_matrix`, providing:
    *   `sourceId`: The handle of the 4D volume (`handle_bold`).
    *   `axis`: `"voxel"`.
    *   `indices`: A `Uint32Array` containing the single `linearIndex` of the picked voxel.
    *   `agg`: `"none"`.
6.  **Rust Backend Fetch:** `TauriCommands::get_timeseries_matrix` receives the request. It looks up the data source (`handle_bold`). If the source implements the optional `TimeSeriesProvider` trait, it calls `provider.matrix_at_voxel([i,j,k])`. Otherwise, it performs a basic extraction from the SAB associated with `handle_bold`.
    *   **Data Access:** Reads the required timeseries data for the specified voxel index. For large 4D files, this might involve memory-mapping (`mmap`) or reading only the necessary chunk from disk, followed by decompression (e.g., Zstandard if used internally).
    *   **Payload Creation:** Constructs the `ResponsePayload`, including the timeseries data in a *new* SAB/ArrayBuffer, shape `[1, T]`, `dtype`, and any available `meta` data (like TR from header).
7.  **Return to UI:** The `ResponsePayload` (with the transferable buffer) is returned to the `PlotPanel`.
8.  **Send to Worker:** `PlotPanel` creates a `DataSample` object (type `dataframe` or `timeseries`) containing the response payload details. It then calls `plotWorker.postMessage({ type: "plot", payload: {..., sample: dataSample, ...} }, [dataBuffer])`, transferring the data buffer efficiently.
9.  **Worker Renders:** `PlotWorker` receives the message. It finds the appropriate `PlotPlugin` based on the `DataSample.type` (or a specific plugin requested). It calls `plugin.render(canvas, dataSample, options)`, passing the OffscreenCanvas, the data (now accessible within the worker), and configuration.
10. **Plotly Draws:** The plugin (e.g., `plot-ts-plotly`) uses Plotly.js to draw the timeseries onto the OffscreenCanvas. The rendered image is automatically displayed in the `PlotPanel`'s canvas element.

### 3.4 Plot Configurability

1.  **UI Controls:** A settings area within `PlotPanel` (or a pop-out drawer) contains controls (sliders, dropdowns, checkboxes) for plot options (e.g., line color, detrending, show events).
2.  **State Update:** User changes trigger actions that update a configuration object within `plotsSlice` for that specific plot panel instance (identified by `targetId`).
3.  **Re-render Request:** An effect watching the config slice sends a new `{ type: "plot", payload: {..., options: newOptions, sample: cachedSampleRef? } }` message to the `PlotWorker`.
4.  **Worker Re-renders:** The worker receives the message and calls the `PlotPlugin`'s `render` function again with the *same data* but the *updated options*, causing Plotly to redraw.
5.  **Persistence:** The plot configuration object within `plotsSlice` should ideally be linked to the GoldenLayout component state (`container.setState({ plotConfig: ... })`) so it's saved and restored with the layout.

## 4. Metadata Handling

*   The optional `meta` field in the `get_timeseries_matrix` response allows the Rust backend (if using a `TimeSeriesProvider`) to send extra information like experiment TR, event timings (e.g., from BIDS `events.tsv`), or filter parameters.
*   The `PlotWorker` passes this `meta` object to the `PlotPlugin`.
*   Plugins designed to handle metadata (e.g., `plot-dataframe-heatmap`, a timeseries plot with event overlays) can use this information to enhance the visualization (e.g., drawing vertical lines for event onsets).
*   UI controls in the `PlotPanel` settings drawer can toggle the visibility of these metadata-driven elements.

## 5. Extensibility Points Review

*   **Plot Types:** Adding new plot types (PSD, etc.) requires creating a new `PlotPlugin` (TS), registering it, and potentially adding new `DataSample` types/variants if the input data differs significantly. The core data fetch (`getTimeseriesMatrix`) remains largely the same.
*   **Aggregation:** Adding ROI aggregation (`agg: "mean"`) requires modifying the Rust implementation of `getTimeseriesMatrix` to:
    1.  Accept an ROI identifier (e.g., atlas label ID or a list of voxel indices).
    2.  Fetch the matrix for all voxels in the ROI.
    3.  Perform the aggregation (mean, median) in Rust *before* returning the single aggregated timeseries (shape `[1, T]`).
*   **Pick Semantics:** Switching between voxel and vertex picking primarily affects the *initial* coordinate lookup (`world_to_voxel` vs. `world_to_surface_vertex`) and the `axis` parameter in the `getTimeseriesMatrix` request. The rest of the pipeline remains the same.

## 6. Low-Risk Wins (Potential Enhancements)

*   **Caching:** Implement an LRU cache in the Rust `DataService` for recently fetched timeseries chunks to reduce disk I/O for repeated clicks in the same area.
*   **Prefetching:** On voxel click, asynchronously trigger fetches for spatially adjacent voxels (e.g., ±1 in i, j, k) to potentially hide latency if the user clicks nearby next.
*   **EventFrame Schema:** Formalize the structure of event data within the `meta` field (e.g., `{ onsets: Float32Array, durations: Float32Array, labels: string[] }`) in `SPEC-json-schemas-v0.1.1.md`.

---

This example clarifies the intended interaction flow, component responsibilities, and how the architecture supports the core click-to-plot use case while remaining extensible. It should serve as a useful reference during the implementation of related milestones (M3, M5, M6).