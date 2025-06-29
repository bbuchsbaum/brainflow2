docs/ADR-001-architecture.md
# ADR-001: Brainflow Phase 1 System Architecture (WebGPU v2)

**Version:** 1.2 (Adds Volume<D> Trait)
**Status:** Adopted
**Context:** Defines the high-level component structure, language choices, and core interaction patterns for Brainflow Phase 1, committing to WebGPU for 2D slice rendering. Introduces the `Volume<D>` trait for abstracting volumetric data representations in the Rust backend.

## 1. Architecture Diagram

```mermaid
classDiagram
    %% stereotypes
    class AppShell <<TS>> {
        Dockview
        Zustand stores
        ResizeBus
    }
    class TreeBrowser <<TS>>
    class VolumeView <<TS>> {
        requestLayerGpuResources()
        cursorPick()
    }
    class SurfaceView <<TS>>
    note right of SurfaceView
        uses Three.js (WebGL backend)
    end note
    class LayerPanel <<TS>>
    class LegendDrawer <<TS>>
    class PlotPanel <<TS>>

    %% --- Core API definitions ---
    class CoreApi <<TS @brainflow/api>> {
        +loadFile() : Promise<VolumeHandle | SurfaceHandle | ...>
        +worldToVoxel()
        +getTimeseriesMatrix()
        +requestLayerGpuResources()
    }
    %% API Handle Traits (conceptual)
    class VolumeHandle <<TS @brainflow/api>> { +id, +voxel_type, +range, +space_info }
    class SurfaceHandle <<TS @brainflow/api>>

    %% --- Rust backend services ---
    class TauriCommands <<Rust>>
    class FileSystemSvc <<Rust>>
    class LoaderRegistry <<Rust>> { +find_loader(), +register() }
    class CoordinateEngine <<Rust>>
    class Vol2SurfSvc <<Rust>>
    class RenderLoopService <<Rust>> {
        (wgpu continuous)
        enqueue_upload()
        drawFrame()
        deviceLost()
    }
    %% NEW: Shared Types Crate
    class BridgeTypes <<Rust core/bridge_types>> {
        BridgeError
        BridgeResult
        Loader <<Trait>>
        VolumeSendable
        VolumeHandleInfo
        ... (Other API structs)
    }
    %% Rust Data Abstraction
    class "Volume_D_" <<Rust Trait>> {
        +Scalar : VoxelData
        +Space : GridSpace_D_
        +space()
        +get()
        +as_bytes()
        +slice_fast_axis()
    }
    class "GridSpace_D_" <<Rust Trait>>
    class DenseVolume3_T_ <<Rust>> { +impl Volume_3_ }
    class NiftiLoader <<Rust>> { +impl Loader }
    // Removed Loader trait from here, now in BridgeTypes

    %% --- Data models (@brainflow/api) ---
    class DataSample <<TS>> { type, data, metadata }
    class DataFrame <<TS>> { shape, columns, buffer, colDtype }


    %% --- Plugin system ---
    class LoaderPlugin <<TS>>
    class PlotPlugin <<TS>>

    %% --- Plot worker ---
    class PlotWorker <<TS>>

    %% ------------ relationships -------------
    AppShell --> TreeBrowser
    AppShell --> VolumeView
    AppShell --> SurfaceView
    AppShell --> LayerPanel
    LayerPanel --> LegendDrawer
    AppShell --> PlotPanel

    %% UI → CoreApi (Async via Tauri Invoke)
    TreeBrowser ..> CoreApi : loadFile()
    VolumeView  ..> CoreApi : voxelToWorld()\ngetTimeseries()
    SurfaceView ..> CoreApi : worldToSurfaceVertex()
    VolumeView ..> CoreApi : requestLayerGpuResources()

    %% CoreApi invokes Tauri Commands
    CoreApi ..> TauriCommands : invoke()

    %% Tauri Commands → Rust Services / Traits
    TauriCommands --> LoaderRegistry : find_loader()
    TauriCommands --> CoordinateEngine
    TauriCommands --> Vol2SurfSvc
    TauriCommands --> RenderLoopService : enqueue_upload()
    LoaderRegistry --> Loader : Uses trait object Box<dyn Loader>
    TauriCommands ..> BridgeTypes : Uses BridgeResult, BridgeError
    // Loader --> "Volume_D_" : returns Box<dyn Volume<D>> // Loader now returns VolumeSendable
    NiftiLoader ..> BridgeTypes : Implements Loader, uses BridgeResult/Error

    %% Internal Rust Interactions
    RenderLoopService --> "Volume_D_" : as_bytes(), get(), space()
    Vol2SurfSvc --> "Volume_D_" : get(), space()
    CoordinateEngine --> "GridSpace_D_"
    TauriCommands ..> "Volume_D_" : Access via registry (indirectly)
    BridgeTypes ..> "Volume_D_" : VolumeSendable wraps Volume<D> impls

    %% Plotting path
    PlotPanel ..> PlotWorker : postMessage(DataSample) %% Async
    PlotWorker --> PlotPlugin : render(DataSample)    %% Sync (within worker)

```

## 2. Language / Ownership Recap

| Component                             | Implementation Language | Notes                                                                                                                               |
| :------------------------------------ | :---------------------- | :---------------------------------------------------------------------------------------------------------------------------------- |
| UI Panels, Plugins, Data Model Defs   | TypeScript              | SABs allocated by Rust, API/Models defined in `@brainflow/api`                                                                      |
| CoreApi Definitions                   | TypeScript (`@brainflow/api`) | Represents the contract for Tauri commands. Uses `VolumeHandle` / `SurfaceHandle` for opaque resource refs.                       |
| **Bridge Types**                      | **Rust (`core/bridge_types`)** | **NEW:** Defines shared traits (`Loader`), error types (`BridgeError`), and data structures (`VolumeSendable`, `VolumeHandleInfo`) used across the Rust backend to break cyclic dependencies. |
| Backend Services & **RenderLoop**     | **Rust**                | `wgpu` rendering, I/O, math, state, service logic. Operates on abstract `Volume<D>` trait where possible. Implements error conversions (`From<RenderLoopError>` for `BridgeError`). |
| **Volumetric Data Abstraction**       | **Rust (`volmath`)**    | `Volume<D>` trait defines generic voxel access. `DenseVolume<T>` provides concrete dense storage (`impl Volume<D>`). `VolumeSendable` (in `bridge_types`) wraps concrete `Volume<D>` implementations. |
| Surface Rendering (Phase 1)           | TypeScript (Three.js)   | Uses WebGL backend, may migrate later                                                                                               |
| Plotting                              | TypeScript Worker       | Plotly via OffscreenCanvas, consumes flexible `DataSample` types derived from Rust data structures (potentially via `Volume<D>` trait). |

**Note on Data Payloads:** The `DataSample` interface, passed from the Core API to the plotting system, is designed to be extensible. While Phase 1 focuses on simple timeseries (`N x T`), the structure supports richer `DataFrame` payloads (`N x K` with named columns and types) provided by loaders implementing the optional `TimeSeriesProvider` trait in Rust. This allows plot plugins to visualize more complex data when available.

## 3. Key Interaction Patterns (NEW)

### 3.1 Layer State & GPU Resource Management

The lifecycle and state of display layers (e.g., visibility, display properties, associated GPU resources) are managed centrally by the Zustand `layerStore`.

*   **State Ownership:** `layerStore` holds the array of `LayerEntry` objects, representing the single source of truth for each layer's specification (`spec`) and its GPU resource status (`gpu`, `isLoadingGpu`, `error`).
*   **Triggering:** UI components initiate file loading (`coreApi.load_file`). Upon success, they create a `LayerSpec`, add it to the `layerStore` (`addLayer`), and immediately trigger the store's `requestGpuResources` action.
*   **Async Handling:** The `layerStore` action handles the asynchronous call to `coreApi.request_layer_gpu_resources` and updates the corresponding `LayerEntry` state upon completion or error.
*   **Rendering:** View components (`VolumeView`, `SurfaceView`) subscribe to `layerStore` and reactively render based on the state provided for the layers they display. They do *not* directly invoke GPU resource allocation APIs or manage the associated asynchronous state.

## 4. Error Handling Conventions

*(No changes needed from previous version - section renumbered)*
*   Rust functions invoked via Tauri commands (`TauriCommands`) that can fail should return a `Result<T, E>` where `E` is a serializable error enum (e.g., `GpuUploadError`, `FileLoadError`, `BridgeError`).
*   Error enums should use `#[serde(tag = "code", content = "detail")]` for structured serialization to JSON where appropriate for UI consumption.
*   The TypeScript `CoreApi` wrapper functions should handle these `Result` types, typically by rejecting the returned Promise with the structured error object if the Rust side returned `Err`.
*   UI components calling `CoreApi` methods should use `.catch()` blocks to handle rejected promises and display appropriate user feedback.
*   Specific error structures (like `GpuUploadError`) are detailed in relevant specification documents (e.g., `ADR-002-multilayer-rendering.md`).

