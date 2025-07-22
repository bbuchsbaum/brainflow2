
# **Architectural Addendum: UI Component Implementation**

This addendum extends the "Brainflow2 React Frontend: Architectural Blueprint" with specific, ready-to-implement code patterns for the core UI panels: `LayerPanel`, `FileBrowserPanel`, and `OrthogonalViewport`. It validates and incorporates the provided mock-ups, ensuring they align with the overall architecture.

## 1. Revisions to Core Architectural Plan

The provided mock-ups are highly aligned with the architectural goals. The following points from the initial proposal are now considered **concrete implementation details**:

*   **State Management:** The use of `zustand/middleware/immer` for the `LayerStore` and `FileTreeStore` is adopted as the standard pattern. This provides safe, direct state mutation within actions, improving developer ergonomics.
*   **Request Coalescing:** The `debounce` function within `LayerService` is the chosen implementation for coalescing rapid UI updates (e.g., slider drags) into efficient backend calls.
*   **Reusable Components:** The `RangeSlider` and `ColorMapSelect` components built on Radix UI are adopted as the standard for control elements.
*   **Backend Command Alignment:** The frontend will use the fine-grained `patch_layer` command, as it is already implemented in the backend. This minimizes backend changes. The `updateAndRender` concept in the `ApiService` will now orchestrate this sequence of fine-grained calls.
*   **Virtualization:** The use of `react-arborist` (or a similar virtualized tree library) for the `FileBrowserPanel` is now a formal part of the plan to ensure scalability.

## 2. Finalized Domain Models (Frontend)

The proposed domain models are excellent and are adopted as the canonical types for the frontend.

```typescript
// types/layer.ts
export interface LayerRender {
  opacity: number;
  colormap: string;
  intensityMin: number;
  intensityMax: number;
  thresholdLow: number;
  thresholdHigh: number;
}

export interface LayerUI {
  id: string;          // UUID, also used as the key on the backend
  name: string;        // e.g., "tpl-MNI152NLin2009cAsym_res-01_T1w"
  visible: boolean;
  isSelected: boolean;
  gpuStatus: 'unallocated' | 'allocating' | 'ready' | 'error'; // Added from review
  error?: string | null;
}

export interface Layer extends LayerUI {
  render: LayerRender; // This object maps directly to the `patch_layer` payload
}

// types/fileTree.ts
export interface FileTreeNode {
  id: string;             // Absolute path – unique key
  name: string;
  parentIdx: number | null;
  iconId: number;         // Numeric ID from backend for consistent icons
  isDir: boolean;
  children?: FileTreeNode[];
}
```

## 3. Detailed Component Implementation Plan

### 3.1. LayerPanel

The provided `LayerPanel.tsx` implementation is adopted as the blueprint.

**Key Architectural Features:**

*   **Optimistic UI:** The `patch` action in the `useLayerStore` immediately updates the local state, providing instant feedback to the user.
*   **Debounced Backend Sync:** The `layerService` coalesces multiple rapid changes from sliders into a single `patch_layer` API call every 80ms, preventing network and backend overload.
*   **Clear Separation:** The component handles UI logic (rendering sliders, handling clicks), the store handles state, and the service handles backend communication.

**Addendum - Next Steps for LayerPanel:**

1.  **Visibility Toggle:** The `👁` / `🚫` button will toggle the `layer.visible` flag in the store. The `LayerService` will listen to this change and call `patch_layer` with an `opacity` of `0` or the layer's stored opacity.
2.  **Delete Layer:** A context menu (using Radix UI) on a layer item will include a "Delete" option. This will call `layerService.deleteLayer(id)`, which in turn invokes `release_layer_gpu_resources` and then removes the layer from the store.
3.  **GPU Status:** The `LayerUI`'s `gpuStatus` will be displayed as an icon (e.g., a spinner for 'allocating', a checkmark for 'ready'). This status is updated by the `LayerService` in response to events from the backend after a `load_file` call.

### 3.2. FileBrowserPanel

The provided `FileBrowserPanel.tsx` implementation using `react-arborist` is adopted.

**Key Architectural Features:**

*   **Backend-Driven Tree:** The component is "dumb" and simply renders the tree structure provided by the `fileService`, which fetches it from the `fs_list_directory` Rust command.
*   **Scalability:** `react-arborist` ensures that even directories with thousands of files are rendered efficiently through virtualization.
*   **Decoupled Action:** Double-clicking or dragging a file calls `fileService.openFile(path)`. This service then orchestrates the `load_file` API call and coordinates with the `LayerService` to create the new layer. The `FileBrowserPanel` itself has no knowledge of layers.

**Addendum - Next Steps for FileBrowserPanel:**

1.  **Lazy Loading:** The `onToggle` handler in the `Tree` component will be extended. If a directory is being expanded for the first time and has no children, it will call a new service method `fileService.fetchNodeChildren(path)`, which will invoke `fs_list_directory` with the new path and a depth of 1.
2.  **Drag-and-Drop from OS:** The main application window will have a global `onDrop` listener. If dropped files are detected, it will parse their paths and pass them to `fileService.openFile()`.
3.  **Search:** A search input will be added to the header. Its `onChange` will filter a *copy* of the flattened node list (kept in the service or a memoized selector) and pass the filtered, re-parented tree to `react-arborist`. This keeps the original tree state intact.

### 3.3. OrthogonalViewport & SliceView

The proposed design for the orthogonal viewer is excellent and formally adopted.

**Key Architectural Features: The Math Contract**

1.  **Frontend Owns the Camera:** The React frontend is solely responsible for calculating the slice plane's geometry (`origin`, `uVec`, `vVec`). This includes handling all user interactions like panning, zooming, and crosshair movement.
2.  **Backend is a Pure Renderer:** The Rust backend receives a purely declarative `SliceSpec`. It knows nothing about the user's viewport size, DPI, or interaction state. Its only job is to "paint" the pixels for the requested world-space plane.
3.  **Pixel-Perfect Rendering:** The `viewportPx` field ensures the backend renders at the exact resolution needed by the canvas, and `createImageBitmap` prevents decoding from blocking the main thread. This guarantees no scaling artifacts or distortion.

**Implementation Details:**

*   **State:** The three `ViewPlane` objects will reside within the `ViewStateStore`, ensuring they are part of the undo/redo stack and are saved with view presets.
*   **Crosshair Synchronization (`crosshairService.ts`):** When the crosshair position is updated (e.g., by a drag in the Axial view), the service will:
    1.  Update the master crosshair position in the `ViewStateStore`.
    2.  Recalculate the `origin` for the *other two* planes (Coronal and Sagittal) by projecting the new crosshair position onto them.
    3.  This single, atomic update to the store triggers a debounced re-render of all three views, keeping them perfectly synchronized.
*   **Image Caching (`stores/imageCache.ts`):** A simple store will hold the latest rendered image for each view.
    ```typescript
    // stores/imageCache.ts
    const useImageCache = create<{
      images: Record<'axial' | 'coronal' | 'sagittal', ImageBitmap | null>;
      updateImage: (kind: 'axial' | 'coronal' | 'sagittal', image: ImageBitmap) => void;
    }>(/* ... */);
    ```
    The `ApiService` updates this cache after a successful render, and each `<SliceView>` subscribes to its respective image.

## 10. Revised Full Architectural Blueprint

Integrating the above specifics results in this final, comprehensive plan.

**(The following is the fully revised blueprint, merging the original proposal with the addendum's specifics)**

# Brainflow2 React Frontend: Architectural Blueprint (Final)

## 1. Core Philosophy & Guiding Principles

1.  **Declarative, "Dumb" Frontend:** The React UI describes the desired `ViewState`. The Rust backend is the "smart" engine that renders it.
2.  **Single Source of Truth for View State:** A single `ViewState` object in a Zustand store is the sole trigger for re-renders.
3.  **Clear Separation of Concerns:** Strict separation between UI Components, State Management, Services, and the API Layer.
4.  **Unidirectional Data Flow:** User Action → Service → Store → Debounced Backend Call → UI Update.

## 2. Revised High-Level Architecture & Data Flow

```mermaid
graph TD
  subgraph "UI Components (React)"
    FileBrowserPanel -- "calls" --> FileService
    LayerPanel -- "calls" --> LayerService
    SliceView -- "calls" --> CrosshairService
    App -- "listens for" --> KeyboardShortcuts
  end

  subgraph "Services (Business Logic)"
    FileService --> LayerService
    LayerService --> ViewStateStore
    CrosshairService --> ViewStateStore
    PlotService
  end

  subgraph "State Management (Zustand)"
    ViewStateStore -- "updated state" --> |debounced| CommandQueue
    PlotStore[PlotStore] --> PlotPanel
    ImageCache[ImageCache] --> SliceView
    KeyboardShortcuts -- "undo/redo" --> ViewStateStore
  end

  subgraph "Backend Communication"
    CommandQueue[CommandQueue] -- "latest ViewState" --> ApiService[ApiService]
    PlotService -- "sample a coordinate" --> ApiService
    ApiService -- "invoke Rust command" --> RustBackend
    RustBackend -- "returns image/plot data" --> ApiService
    ApiService --> ImageCache
    ApiService --> PlotStore
  end

  EventBus((EventBus))
  CrosshairService -- "emits crosshair.updated" --> EventBus
  EventBus -- "triggers" --> PlotService
```

## 3. State Management (Zustand with Middleware)

*   **`useViewStateStore`:**
    *   Holds the canonical `ViewState` object.
    *   Wrapped with **`zundo`** for undo/redo functionality.
    *   Wrapped with a **custom `coalesceUpdatesMiddleware`** to debounce rapid state changes (e.g., slider drags) into a single backend call per animation frame.

*   **`useLayerStore` & `useFileTreeStore`:**
    *   As detailed in the mock-ups, these stores manage the layer stack and file browser tree respectively.
    *   They use **`zustand/middleware/immer`** for easy, direct state manipulation.
    *   Their actions implement an **optimistic UI** pattern, updating the state instantly and then calling a service to sync with the backend.

*   **`useImageCache` & `usePlotStore`:**
    *   Simple stores that cache the latest data received from the backend for the orthogonal views and plot panel. Components subscribe to these to update reactively without triggering new backend requests.

## 4. Backend Communication (`ApiService` & Rust Facade)

*   **Rust Backend Facade:** A new command, `apply_and_render_view_state(viewStateJson: string)`, will be added to `api_bridge/src/lib.rs`. This command will parse the JSON `ViewState` and internally call the existing fine-grained Rust functions (`set_crosshair`, `update_layer`, `update_frame_ubo`, `render_to_image_binary`). This provides atomicity and simplifies the frontend API surface.
*   **Frontend `ApiService`:** This singleton will primarily use the new `apply_and_render_view_state` command. It will also expose other commands like `fs_list_directory` and `sample_world_coordinate`. It uses `createImageBitmap` to decode returned image data off the main thread.

## 5. Component Implementation Details

*   **`LayerPanel`:**
    *   **Implementation:** As per the provided mock-up, using `RangeSlider` and `ColorMapSelect` components.
    *   **Lifecycle:** A "Delete" action in a context menu will call `layerService.deleteLayer(id)`, which invokes `release_layer_gpu_resources` on the backend before removing the layer from the store.
    *   **GPU State:** The `LayerUI` type will include a `gpuStatus: 'unallocated' | 'allocating' | 'ready' | 'error'` field, updated by the `LayerService` based on backend events, to provide visual feedback to the user.

*   **`FileBrowserPanel`:**
    *   **Implementation:** As per the mock-up, using `react-arborist` for virtualization.
    *   **Scalability:** Directory expansion will trigger a `fileService` call to `fs_list_directory` with an updated path and a depth of 1 for lazy loading.
    *   **Drag & Drop:** Both internal drag-and-drop from the tree and external drag-and-drop from the OS will resolve to a file path and call `fileService.openFile(path)`.

*   **`OrthogonalViewport` & `SliceView`:**
    *   **Layout:** A CSS Grid layout as described, with the Axial view occupying the top 55% and Sagittal/Coronal views splitting the bottom row.
    *   **Math Contract:** The `SliceView` calculates the world coordinate under the cursor using the `origin`, `uVec`, and `vVec` from its `ViewPlane` state. It sends this coordinate to the `CrosshairService`.
    *   **Synchronization:** The `CrosshairService` updates the master crosshair position and recalculates the origins for the other two planes, ensuring all three views are always centered on the same world point. This triggers a single, unified `ViewState` update.

## 6. Scalability & UX Enhancements

*   **Undo/Redo:** Handled by `zundo` middleware on the `ViewStateStore`. Keyboard shortcuts will trigger the store's `undo()` and `redo()` methods.
*   **Shareable Links:** A "Share" UI element will serialize the current `ViewState` to a Base64 string and update the URL query parameter (`?view=...`). App startup logic will check for this parameter, decode it, and initialize the `ViewStateStore` with it.
*   **Error Handling:** A global React Error Boundary and a `NotificationService` will catch and display errors from both the frontend and the backend's `ErrorDisplay` type in user-friendly toasts.
*   **Theming:** A `useTheme` context will provide `light`/`dark` mode settings, and components will use CSS variables to adapt.
*   **Keyboard Shortcuts:** A global key listener will map shortcuts (e.g., `[`, `]`) to service calls (`layerService.cycleSlices()`).
*   **Colormap Previews:** The `ColorMapSelect` component will render a small SVG `<linearGradient>` for each colormap option, providing a visual preview.
*   **Layout Persistence:** The GoldenLayout configuration will be serialized to `localStorage` on change and restored on application load.

## 7. Testing Strategy

*   **Backend Stubbing:** An injectable `BackendTransport` interface will allow swapping the real Tauri-based transport with a `MockTransport` in Vitest. The mock will return pre-recorded data fixtures, enabling robust testing of services without a GPU or running backend.
*   **E2E Testing:** Playwright will be configured to run in its Electron mode, allowing it to directly interact with the packaged desktop application for true end-to-end validation.
*   **Visual Regression:** Percy or a similar service will be integrated into the E2E test suite to capture snapshots of the `OrthogonalViewport` and `LayerPanel` after specific actions, preventing visual regressions.

This revised blueprint is now more detailed, practical, and directly addresses the specific capabilities and constraints of the existing backend, setting a clear and robust path for developing the React frontend.

This is another outstanding, surgical review. The feedback is precise, actionable, and demonstrates a deep understanding of both the proposed architecture and the potential pitfalls in a real-world application. The suggestions will significantly enhance the robustness and user experience of the final product.

Here is the requested addendum, which fully integrates these improvements into a new, final section of the architectural blueprint. This addendum focuses on refining the UI component implementations with these advanced considerations.

---

# **Architectural Addendum: Advanced UI Implementation & Refinements**

This addendum builds upon the "Brainflow2 React Frontend: Architectural Blueprint (Revised)" by incorporating detailed feedback on technical soundness, scalability, and UX. It provides concrete implementation strategies for the UI components to create a truly production-ready system.

## 1. Core UI Elements: Finalized Implementation Patterns

The following sections detail the refined patterns for the `LayerPanel`, `FileBrowserPanel`, and `OrthogonalViewport`, incorporating the latest feedback.

### 1.1. `LayerPanel`: Batch Updates & Lifecycle Management

The `LayerPanel` will be enhanced to handle state more efficiently and manage the full lifecycle of a layer.

**A. Batch Patching for Performance:**
To address the issue of multiple `patch_layer` calls from simultaneous UI changes, we will introduce a batching mechanism within the `LayerService`.

```typescript
// services/layerService.ts
import { throttle } from 'lodash-es'; // Using throttle is a better fit than debounce here
import { type LayerRender } from '@/types/layer';

class LayerService {
  private pendingPatches = new Map<string, Partial<LayerRender>>();

  private flushPatches = throttle(() => {
    this.pendingPatches.forEach((patch, id) => {
      invoke('patch_layer', { layerId: id, patch });
    });
    this.pendingPatches.clear();
  }, 16, { leading: false, trailing: true }); // Throttle to one flush per frame

  public patchLayer(id: string, patch: Partial<LayerRender>) {
    const existing = this.pendingPatches.get(id) || {};
    this.pendingPatches.set(id, { ...existing, ...patch });
    this.flushPatches();
  }
  // ... other methods
}
```
*   **Result:** This pattern ensures that rapid, consecutive slider adjustments for opacity, intensity, and threshold on the same layer result in a **single, coalesced API call per animation frame**, preventing IPC backlog while maintaining responsive UI feedback.

**B. Full Layer Lifecycle Management:**
The `LayerPanel` will expose UI for the full layer lifecycle.

*   **Deletion:** A context menu on each layer item will trigger `layerService.deleteLayer(id)`. This service will:
    1.  Invoke `release_layer_gpu_resources({ layerId: id })` on the backend.
    2.  On success, remove the layer from the `useLayerStore`.
    3.  The backend's `release_layer_gpu_resources` command is now **mission-critical** and must be robust, ensuring it correctly removes the `layer_to_atlas_map` entry to prevent ghost resources.
*   **Visibility Toggle (`👁`/`🚫`):** This will toggle the `layer.ui.visible` flag. The `LayerService` will listen to this change and call `patchLayer(id, { opacity: newOpacity })`, where `newOpacity` is either `0` or the layer's stored opacity value.

### 1.2. `FileBrowserPanel`: Scalability & User Experience

The file browser will be enhanced to handle large, deeply nested datasets gracefully.

*   **Lazy Loading & Depth Control:** The `fs_list_directory` Rust command will be modified to accept an optional `maxDepth` parameter.
    *   The `FileBrowserPanel` will initially call `fs_list_directory({ path, maxDepth: 1 })`.
    *   When a user expands a directory node, the `onToggle` handler in `react-arborist` will check if the node's children have been loaded. If not, it will call `fileService.fetchNodeChildren(path)`, which invokes `fs_list_directory` for that specific subdirectory.
    *   This "depth-first paging" prevents the frontend from being overwhelmed by huge directory trees.

*   **Search (As-You-Type Fuzzy Finder):**
    *   A `Cmd+P`-style command palette will be added.
    *   On first mount, the `FileService` will fetch the *entire* file list (with a user-configurable or reasonable `maxDepth`, e.g., 5) in the background and store the flat list.
    *   The command palette will use a lightweight fuzzy-search library like `Fuse.js` to filter this cached list instantly on the client side, providing immediate search results without hitting the backend.

*   **Caching with IndexedDB:** To make re-mounting large directories instantaneous, the `FileService` will cache the fetched tree structure and file modification times in **IndexedDB**. On a subsequent mount of the same directory, it will first display the cached tree and then issue a background request to the backend to check for updates.

### 1.3. `OrthogonalViewport`: Math Precision & Crosshair Data Flow

The `OrthogonalViewport` is the core of the user's interaction and requires precise handling of coordinate systems.

*   **Matrix Orientation Guarantee:** A critical integration test will be added. This test will:
    1.  Create a phantom volume in Rust with a known, asymmetric pattern.
    2.  Define a `SliceSpec` in the test with a non-trivial orientation.
    3.  Call the `apply_and_render_view_state` command with this spec.
    4.  Assert that the returned PNG bytes match a "golden" snapshot file.
    This test runs in CI and will immediately fail if a change in `nalgebra`, `wgpu`, or the frontend's matrix math causes an axis flip or scaling error.

*   **Plot Panel Data Flow:** The flow for populating the `PlotPanel` is now explicitly defined:
    1.  The user clicks on a `<SliceView>`.
    2.  The `CrosshairService` updates the crosshair position in the `ViewStateStore`.
    3.  Simultaneously, it emits a `crosshair:clicked` event on the global `EventBus` with the world coordinate payload.
    4.  The `PlotService`, a dedicated service, listens for this event.
    5.  The `PlotService` invokes the relevant backend command (e.g., `get_time_series`, `sample_world_coordinate`).
    6.  Upon receiving the data, the `PlotService` updates the `usePlotStore`.
    7.  The `PlotPanel` component, subscribed to `usePlotStore`, re-renders with the new data.
    *   **Benefit:** This decouples plotting logic from the main rendering loop entirely. The plot panel can have its own loading/error states without affecting the slice views.

## 4. Advanced Architectural & UX Refinements

### 4.1. State Management & Concurrency

*   **Undo Memory Footprint:** The `useViewStateStore` will be configured with `zundo({ limit: 50 })` to cap the history and prevent unbounded memory growth. For long sessions, a future enhancement could involve serializing older history states to IndexedDB.
*   **GoldenLayout & Undo:** The GoldenLayout state will be managed exclusively via `localStorage`. It will *not* be part of the `ViewStateStore`, thus correctly separating transient UI layout from undoable application state.
*   **Concurrency:** The `coalesceUpdatesMiddleware` naturally handles race conditions between services. Since all updates funnel through `setViewState`, and the middleware only flushes the *very latest* state in the next animation frame, it implicitly merges changes from `CrosshairService` and `LayerService` into a single, consistent backend update.

### 4.2. Accessibility & Theming

*   **Keyboard Navigation:** A global `useKeyboardShortcuts` hook will be implemented. It will listen for key presses and call the appropriate services.
    *   `[` / `]`: `layerService.cycleActiveLayer()`.
    *   Arrow Keys: `crosshairService.moveByVoxels(dx, dy)`.
    *   `PageUp` / `PageDown`: `crosshairService.moveSlice(dz)`.
*   **ARIA Attributes:** All custom controls like `RangeSlider` will have `aria-label` and `aria-valuenow` attributes to be fully accessible to screen readers.
*   **Theming:** A `ThemeStore` will provide `light`, `dark`, and `high-contrast` options. CSS variables will be used for theming, ensuring that not just colors but also UI element borders and contrasts adapt correctly, which is critical for viewing radiological images in different lighting conditions (e.g., a dark reading room vs. a bright presentation).

### 4.3. User Experience Polish

*   **Colormap Authoring:** A new UI component, `<ColorMapEditor>`, will allow users to create custom gradients. On save, it will generate a 256x4 `Uint8Array` and call a new Rust command, `update_custom_colormap(id: string, data: Uint8Array)`, allowing for dynamic, runtime colormap updates.
*   **File Drop:** The `OrthogonalViewport` will implement `onDragOver` and `onDrop` handlers. When a valid file is dropped from the OS, it will call `fileService.openFile(droppedPath)`, providing a seamless workflow.
*   **Performance:** All images returned from the backend (as binary PNGs) will be decoded using `createImageBitmap()` in the `ApiService` before being placed in the `ImageCache`. This moves image decompression off the main thread, preventing UI stutters.

## 5. Finalized Risk Mitigation

*   **IPC Backlog:** Addressed by throttling `patch_layer` calls and using a coalescing middleware for full `ViewState` updates.
*   **GPU Resource Leaks:** The `LayerService` will use `try...catch...finally` blocks around GPU allocation calls. If `request_layer_gpu_resources` fails, the `finally` block will immediately call `release_layer_gpu_resources` to prevent ghost entries.
*   **Large File Stalls:** The `FileBrowserPanel`'s lazy loading is the first step. The next is to modify the Rust `load_file` command to be asynchronous, emitting progress events to the frontend via the `NotificationService`.

This addendum solidifies the architectural blueprint, providing concrete, low-risk, and high-impact solutions to the identified gaps. The resulting design is not only robust and maintainable but also provides a superior and highly responsive user experience.