Okay, here is the revised UI Layout Guide (v1.2), incorporating the latest feedback and clarifications.

---

# `docs/GUIDE-ui-layout-phase1.md`

**Version:** 1.2 (WebGPU v2 Aligned, Post-Review)
**Status:** Finalized for Phase 1 Implementation
**Date:** [Insert Date]
**Context:** Defines the initial UI layout structure, component registration, interaction patterns, persistence, and lifecycle management for Brainflow Phase 1, using GoldenLayout v2 and shadcn-svelte.

## 1. Screen Layout at App Boot

The application uses GoldenLayout v2 for its primary window structure. The default layout arranges panels as follows:

```mermaid
flowchart TB
    subgraph MainWindow["Brainflow Desktop — GoldenLayout Root"]
        direction LR
        TreeStack[("Left Pane<br/>**TreeBrowser**<br/>(20%, min: 160px)")]:::pane_stack
        MainStack[("Main Stack (Tabbed)<br/>(60%, min: 300px)")]:::pane_stack
        InspectorColumn[Right Column<br/>(20%, min: 220px)]:::pane_column

        subgraph MainStackContent[" "]
            direction TB
            ViewTab1(🔳 Volume/Surface View):::tab
            ViewTabNew(➕ New Tab):::tab
        end

        subgraph InspectorColumnContent[" "]
            direction TB
            TopRightStack["Top Stack (60%)"]:::pane_stack --> LayerTab(🔧 Layers):::tab
            TopRightStack --> LegendTab(📑 Atlas Legend):::tab
            BottomRightPane["Plot Pane<br/>(40%, min: 180px)"]:::pane --> PlotPanel(📈 Plot Panel):::component_label
        end
    end
    StatusBar([🚦 StatusBar – Coords | FPS | VRAM | Messages]):::bar

    MainWindow --> StatusBar

    %% Definitions for styling
    classDef pane_stack fill:#f0f4f8,stroke:#b0c4de,color:#333;
    classDef pane_column fill:#e6eaf0,stroke:#b0c4de,color:#333;
    classDef pane fill:#f6f8fa,stroke:#ccc;
    classDef tab fill:#e7ecf0,stroke:#ccc,color:#555;
    classDef bar fill:#282c34,color:#abb2bf,stroke:#444;
    classDef component_label fill:none,stroke:none,color:#0056b3,font-weight:bold;

    %% Link high-level structure first
    MainWindow --- TreeStack & MainStack & InspectorColumn

    %% Link components/tabs to their containers
    TreeStack --- CompTreeBrowser(TreeBrowser):::component_label
    MainStack --- MainStackContent
    InspectorColumn --- TopRightStack & BottomRightPane
    TopRightStack --- LayerTab & LegendTab
    BottomRightPane --- PlotPanel
```

*   **Layout Manager:** GoldenLayout v2 (via factory functions).
*   **Structure:** A root **row** with three main children:
    1.  **Left Stack:** Contains the `tree-browser` component (initial width 20%, min 160px). *(Correction: Using a stack allows potential future additions here and aligns better with GL philosophy)*.
    2.  **Center Stack (`main-stack`):** Tabbed stack for primary views (`volume-view`, `surface-view`) and the "+ New" initiator (initial width 60%, min 300px).
    3.  **Right Column (`inspector-column`):** (initial width 20%, min 220px) containing:
        *   *Top Stack:* Tabbed stack (`inspector-top-stack`, 60% height) with `layer-panel` and `legend-drawer` tabs.
        *   *Bottom Pane (`plot-pane`):* Contains the `plot-panel` component (40% height, min 180px). *(Correction: Renamed for clarity)*.

## 2. Component Registry & Purpose

Components registered with GoldenLayout. **`componentType` MUST be `kebab-case`**.

| GL `componentType` | Svelte File (`ui/lib/components/...`) | Purpose                                          | Key Zustand Slice(s)         | Default Title    |
| :----------------- | :------------------------------------ | :----------------------------------------------- | :--------------------------- | :--------------- |
| `tree-browser`     | `TreeBrowser.svelte`                  | Mount/scan folders, drag files.                  | `fsSlice`, `volumeStore`     | Files            |
| `volume-view`      | `views/VolumeView.svelte`             | **Default: 3-panel orthogonal viewer (Ax/Cor/Sag).** WebGPU canvases, interactions, crosshair sync. *Note: Canonical path is `ui/src/lib/components/views/VolumeView.svelte`* | `layerStore` (LayerStack)    | Volume View      |
| `surface-view`     | `SurfaceView.svelte`                  | Three.js surface canvas, interactions.           | `layerStore` (LayerStack)    | Surface View     |
| `layer-panel`      | `LayerPanel.svelte`                   | List & controls for active layers.               | `layerStore` (LayerStack)    | Layers           |
| `legend-drawer`    | `LegendDrawer.svelte`                 | Atlas label table, interactions.                 | `layerStore` (LayerStack), `atlasStore`? | Atlas Legend     |
| `plot-panel`       | `PlotPanel.svelte`                    | Hosts Plotly worker via OffscreenCanvas.         | `plotsSlice`                 | Plots            |
| `status-bar`       | `StatusBar.svelte`                    | Footer display (coords, FPS, VRAM, messages).    | `uiSlice`, `layerStore`?     | *(Not in GL)*    |

*   **UI Primitives:** Internal layout and controls use `shadcn-svelte`. GoldenLayout provides the windowing chrome.

## 3. GoldenLayout Initialization & Configuration

Defined in `ui/src/lib/layout/defaultLayout.ts` (or similar). **Note:** Uses `LayoutConfig` type.

```typescript
// Example: ui/src/lib/layout/defaultLayout.ts
import type { LayoutConfig } from 'golden-layout'; // Use LayoutConfig type

export const defaultLayout: LayoutConfig = {
  root: {
    type: "row",
    content: [
      // Column 0: Tree Browser Stack
      {
        type: "stack", // Changed: Tree is in a stack
        width: 20,
        minWidth: 160,
        content: [{
          type: "component",
          componentType: "tree-browser",
          title: "Files"
        }]
      },
      // Column 1: Main Stack
      {
        type: "stack",
        id: "main-stack",
        width: 60,
        minWidth: 300,
        content: [
          // Initial view typically added programmatically or from persisted state
        ]
      },
      // Column 2: Inspector Column
      {
        type: "column",
        id: "inspector-column",
        width: 20,
        minWidth: 220,
        content: [
          {
            type: "stack",
            id: "inspector-top-stack",
            height: 60,
            content: [
              { type: "component", componentType: "layer-panel", title: "Layers" },
              { type: "component", componentType: "legend-drawer", title: "Atlas Legend" }
            ]
          },
          {
            type: "component", // Changed: Plot Panel is directly in the column
            id: "plot-pane", // ID for the container/pane
            componentType: "plot-panel",
            title: "Plots",
            height: 40,
            minHeight: 180 // minHeight applies to the component item
          }
        ]
      }
    ]
  },
  settings: {
    showPopoutIcon: false,
    showMaximiseIcon: true,
    showCloseIcon: true,
  },
  dimensions: {
    borderWidth: 3, // Reduced border size
    minItemHeight: 150,
    minItemWidth: 160,
    headerHeight: 28, // Slightly adjusted header height
  }
};
```

*   Instance created in `AppShell.svelte`, provided via context. Components registered via `glRegister` (Section 5.1).

## 4. Styling Guidelines (shadcn-svelte)

*(No changes from previous version - use theme variables, consistent padding, apply styles to content cards)*

## 5. Component State & Lifecycle Management

### 5.1 Registration Wrapper (`glRegister`)

A wrapper function handles mounting/unmounting Svelte components within GoldenLayout containers and manages resource cleanup.

```typescript
// Example: ui/src/lib/layout/glUtils.ts
import type { ComponentContainer, JsonValue } from 'golden-layout';
import type { SvelteComponent, ComponentProps } from 'svelte';
import { coreApi } from '$lib/api'; // Access CoreApi
import { getContext, setContext } from 'svelte';

// Define a context key
const GL_CONTAINER_CONTEXT_KEY = Symbol('gl-container');

export function glRegister<T extends typeof SvelteComponent>(
    layoutManager: GoldenLayout,
    componentType: string,
    SvelteComp: T,
    defaultTitle: string = "Panel"
) {
    layoutManager.registerComponentFactoryFunction(componentType, (container, initialState) => {
        const host = document.createElement('div');
        host.style.position = 'relative'; // Needed for absolute positioning within
        host.style.overflow = 'auto';
        host.style.height = '100%';
        container.element.append(host);

        // Provide container API via Svelte context within this component tree
        const context = new Map<any, any>([
            [GL_CONTAINER_CONTEXT_KEY, container]
        ]);

        const comp = new SvelteComp({
            target: host,
            props: { initialState: initialState as ComponentProps<InstanceType<T>>['initialState'] },
            context: context,
        });

        if (!container.title && defaultTitle) {
            container.setTitle(defaultTitle);
        }

        // --- Cleanup Hook ---
        container.on('destroy', () => {
            try {
                comp.$destroy(); // Ensures Svelte cleanup (onDestroy)
            } catch (e) { console.error(`Error destroying Svelte component '${componentType}':`, e); }

            // Best-effort backend cleanup using persisted state if available
            const state = container.state as { id?: string }; // Assume state contains 'id' if needed
            const componentId = state?.id || container.id; // Use state.id or fallback to container id

            if (componentId) {
                coreApi.release_view_resources(componentId) // Use snake_case
                    .then(result => {
                        if (!result.ok) {
                            console.warn(`Resource release failed for ${componentId}: ${result.reason}`);
                            // TODO: Implement retry queue if needed (see offlineCleanupQueue discussion)
                        }
                    })
                    .catch(e => {
                        console.error(`API call failed for resource release ${componentId}:`, e);
                        // TODO: Implement retry queue
                    });
            }
        });

        // Inform component container about resize (needed for internal canvas/WebGL)
        container.on('resize', () => {
             // Components needing manual resize can listen to this via container prop
             // OR use the ResizeBus from uiState
             const { width, height } = container.element.getBoundingClientRect();
             if (comp && typeof (comp as any).onResize === 'function') {
                 (comp as any).onResize(width, height);
             }
             // Also update own size if needed
             // container.setSize(width, height); // Usually GL handles this
        });
    });
}

// Helper to get container from context within components
export function getGlContainer(): ComponentContainer {
    return getContext<ComponentContainer>(GL_CONTAINER_CONTEXT_KEY);
}
```

### 5.2 Component State Hygiene

*   **On Mount/Construction:**
    1.  Retrieve the container: `const container = getGlContainer();`
    2.  Read persisted state: `const state = container.getState() as { volumeId?: string, /* other props */ };`
    3.  If `state` exists, use it to rehydrate the component (e.g., `if (state.volumeId) { loadVolume(state.volumeId); }`).
*   **On State Change:**
    1.  Whenever the component's identifying state changes (e.g., new `volumeId`), update the container state: `container.setState({ volumeId: newId, /* other persistable props */ });`.
*   **Resize:** Components embedding their own canvas (`VolumeView`, `SurfaceView`) should listen to the `ResizeBus` (`uiState.viewportSize`) or the container's `resize` event (if passed as prop or accessed via context) and call their internal renderer's resize method (e.g., `renderer.setSize`, `gl.viewport`).

## 6. User Layout Customization & Persistence

*   **Interaction:** Standard GoldenLayout drag/drop/resize enabled.
*   **Persistence:**
    *   A **300ms debounced** function listens to `layoutManager.on('stateChanged', handler)`.
    *   `handler` calls `layoutManager.saveLayout()` and sends the result via `coreApi.save_config({ glLayout: ... })`.
    *   **On Application Exit:** Use Tauri's `window.onCloseRequested` (or equivalent application lifecycle event) to **flush** the debounced save function, ensuring the final layout is persisted. (`beforeunload` is not reliable in Tauri/Electron).
*   **Restoration:** On boot, load `glLayout` from config via `coreApi.load_config()`. If present, use `goldenLayout.loadLayout()`; otherwise, use `defaultLayout`.
*   **Reset:** Menu item clears `glLayout` in config, reloads `defaultLayout`.

## 7. Legend Drawer Behavior

*   **Placement:** Sibling tab to `layer-panel` in the top-right stack.
*   **Auto-Open Logic:** Zustand selector `atlasSlice.hasVisibleAtlas` triggers effect; if `true` && not user-closed && not active -> `layoutManager.activateTab('legend-drawer')`.
*   **User Override:** Closing sets `atlasSlice.userClosedLegend = true`. Loading *new* atlas resets flag.
*   **Pinning:** Toggle control persists a `keepOpen` flag (or similar logic).

## 8. "+ New" Tab Workflow

1.  Click "+" tab initiator.
2.  Show **Quick-Open modal** (`shadcn-svelte Dialog`).
3.  Modal: Select source (Tree view), Choose View Type (Volume/Surface radio).
4.  Confirm -> Modal closes.
5.  Call `layoutManager.addStackItem('main-stack', { type: 'component', componentType: chosenType, title: file, state: { filePath } })`.
6.  New component instance reads `filePath` from `initialState` and triggers `coreApi.load_file`.

## 9. UX Polish Items

*   **Minimum Pane Sizes:** Defined in `defaultLayout` config.
*   **Loading States:** Use `<Skeleton />` component from `shadcn-svelte` (or similar) as overlays within panes during async operations (`requestLayerGpuResources`, plot data fetch).
*   **Error States:** Display errors contextually within panes using standard alert/card components, include retry options where appropriate.

## 10. Milestone Integration

*(No changes from previous version - outlines component implementation timing)*

## 11. Layer Controls Panel & Real-Time Layer Editing

### 11.1 Conceptual Model

The Layer Controls panel provides a tabbed interface for editing the display properties of the currently selected layer (volume or surface). It is tightly integrated with the Zustand `layerStore` and updates the Rust-side UBO in real time.

```
┌─────────────────────────────────────────────────────────┐
│  LayerPanel  (list)  ──select──▶  selectedLayerId store │
└─────────────────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  LayerControls (this file)                             │
│  ┌─────────────── Tab bar ───────────────┐             │
│  │  ♟ Layers │ ◐ Window/Level │ ☰ Blend │             │
│  └───────────────────────────────────────┘             │
│  ┌─ Content (reacts to tab + layer props) ────────────┐│
│  │  * Opacity slider                                  ││
│  │  * Colormap dropdown (virtual list)                ││
│  │  * Double-thumb range slider  (lo / hi threshold)  ││
│  │  * Window centre & width  (number inputs)          ││
│  └────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

- **Data flow:**  
  - UI ➜ Rust: `layerStore.patch(id, delta)` → debounced (80ms) call to `coreApi.patch_layer(id, delta)` (Tauri command), non-blocking.
  - Rust ➜ UI: Once `patch_layer` returns, store is mutated and controls re-render (≤1 frame).
- **No prop-drilling:** All viewers and controls subscribe to `layerStore.layers` and `selectedLayerId`.

### 11.2 Store Structure (`/ui/src/lib/stores/layers.ts`)

```ts
import { createStore } from 'zustand/vanilla'

export interface LayerProps {
  id: string
  name: string
  type: 'volume' | 'surface'
  opacity: number
  colormap: string
  window: { centre: number; width: number }
  thresh: { low: number; high: number }
  blend: 'alpha' | 'add' | 'max' | 'min'
  gpu: { uboIndex: number } | null
}

interface LayerState {
  layers: LayerProps[]
  selectedId: string | null
  select: (id: string)=>void
  patch: (id: string, delta: Partial<LayerProps>)=>void
}

export const layerStore = createStore<LayerState>((set,get)=>({
  layers: [],
  selectedId: null,
  select: id => set({ selectedId: id }),
  patch: (id, delta) => {
    set(state => ({
      layers: state.layers.map(l => l.id===id ? {...l, ...delta} : l)
    }))
    // debounce inside helper:
    debouncedPatchToRust(id, delta)
  }
}))
```

### 11.3 Svelte Component Scaffold

```svelte
<script lang="ts">
  import { $store } from 'svelte'
  import { layerStore } from '$lib/stores/layers'

  const layers = $store(layerStore, s=>s.layers)
  const selectedId = $store(layerStore, s=>s.selectedId)
  const layer = $computed(() => layers.find(l => l.id===selectedId))

  let tab: 0|1|2 = 0

  function update(delta: Partial<typeof layer>) {
    if (!layer) return
    layerStore.getState().patch(layer.id, delta)
  }
</script>

{#if !layer}
  <div class="empty-msg">Select a layer</div>
{:else}
  <TabBar bind:tab />
  {#if tab===0}
      <Slider label="Opacity" min={0} max={1} step={0.01}
              value={layer.opacity}
              on:change={e=>update({opacity: e.detail})}/>
      <Select label="Blend" options={['alpha','add','max','min']}
              value={layer.blend}
              on:change={e=>update({blend:e.detail})}/>
  {:else if tab===1}
      <Number label="Centre" value={layer.window.centre}
              on:change={v=>update({window:{...layer.window,centre:v}})}/>
      <Number label="Width"  value={layer.window.width}
              on:change={v=>update({window:{...layer.window,width:v}})}/>
  {:else}
      <RangeSlider label="Threshold"
                   min={0} max={1}
                   low={layer.thresh.low}
                   high={layer.thresh.high}
                   on:change={(e)=>update({thresh:e.detail})}/>
      <ColormapPicker value={layer.colormap}
                      on:select={cm=>update({colormap:cm})}/>
  {/if}
{/if}
```

### 11.4 Range Slider Recommendation

For double-thumb sliders (window/level, threshold), use [`svelte-range-slider-pips`](https://github.com/simeydotme/svelte-range-slider-pips):

- Pure Svelte, Tailwind-friendly, supports two handles, keyboard, RTL, and live labels.
- Example usage:

```svelte
<RangeSlider
  values={[winLow, winHigh]}
  min={-5}
  max={15}
  step={0.1}
  range
  on:change={handleChange}
  class="w-full my-2 [--range-color:#38bdf8]"  />
```

### 11.5 Rust Bridge

Add a new Tauri command:

```rust
#[tauri::command]
pub async fn patch_layer(id: String, delta: LayerPatch) -> BridgeResult<()> {
    let mut reg = GLOBAL_LAYER_REGISTRY.write().await;
    let layer = reg.get_mut(&id).ok_or_else(|| BridgeError::LayerNotFound(id.clone()))?;
    layer.apply_patch(&delta);
    RENDER_LOOP.write().await.update_layer_ubo(layer)?;
    Ok(())
}
```

- `LayerPatch` derives `serde::Deserialize`; only changed fields are `Some`.
- Called from the debounced JS helper (80 ms covers slider chatter).

### 11.6 GoldenLayout Registration

```ts
import { glRegister } from '$lib/layout/glUtils'
import LayerControls from '$lib/components/panels/LayerControls.svelte'

glRegister('LayerControls', LayerControls, {
  width: 25,   // % (docked right)
  minWidth: 20,
  closePopout: false,
})
// In default layout:
{ type:'component', componentType:'LayerControls', isClosable:false }
```

- When no layer is selected, show a grey "Select a layer" placeholder.
- When multiple layers exist, the top of the panel can show a clickable list (id + eye icon).

### 11.7 Touch Points & Next Steps

- `layerStore` is now canonical; remove duplicate copies in `VolumeView`.
- `VolumeView` reads `layerStore.layers` each frame and updates its bind-group if opacity/window changed (fast UBO write, no GPU re-upload).
- Extend shader struct + WGSL sampling logic as per ADR-002.
- Manual test: load two layers, slide opacity, observe.

---

ADR-002 cross-reference:  
Add a note in ADR-002 Section 3 and 8 that the LayerUBO fields and update contract are detailed in the UI Layout Guide, Section 11.

## 12. Layer Loading & State Management Lifecycle

This section clarifies the flow for loading data files and managing the state of the corresponding display layers, ensuring a clear separation of concerns and a single source of truth within the `layerStore`.

1.  **Initiation (e.g., `TreeBrowser`, Future Modals):**
    *   User action (drop, browse) provides a file path.
    *   Component calls `coreApi.load_file(filePath)`.
    *   On success, receives `VolumeHandleInfo` (or similar for other types).
    *   Adds the handle info to the relevant resource store (e.g., `volumeStore.add(handleInfo)`).

2.  **Layer Spec Creation (Initiating Component):**
    *   Generates a unique `layerId` (e.g., `nanoid()`).
    *   Creates a `LayerSpec` object (e.g., `{ id: layerId, type: 'Volume', source_resource_id: handleInfo.id, colormap: 'grayscale', ... }`).
    *   Calls `layerStore.getState().addLayer(layerSpec)` to register the layer conceptually.

3.  **GPU Resource Request Trigger (Initiating Component):**
    *   Immediately following `addLayer`, calls `layerStore.getState().requestGpuResources(layerId)`. This delegates the async operation and state management to the store.

4.  **Async GPU Resource Management (`layerStore` Action):**
    *   The `requestGpuResources` action within `layerStore`:
        *   Sets `isLoadingGpu = true` for the layer.
        *   Calls the backend: `coreApi.request_layer_gpu_resources(layerSpec)`.
        *   Handles the promise result:
            *   On success: Updates the layer entry with the received `gpuInfo` (`setGpuInfo`).
            *   On error: Updates the layer entry with the `error` (`setLayerError`).
        *   Sets `isLoadingGpu = false`.

5.  **Rendering (e.g., `VolumeView`):**
    *   Subscribes to `layerStore`.
    *   Selects the relevant `LayerEntry` state for the layer(s) it needs to display.
    *   Renders based on the `spec`, `gpu`, `isLoadingGpu`, and `error` fields provided by the store.
    *   **Does NOT directly call `coreApi.request_layer_gpu_resources`.**

This store-centric approach ensures that the loading status and GPU resource availability are managed centrally and reactively, simplifying the view components.