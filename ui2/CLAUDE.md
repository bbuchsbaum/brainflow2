# CLAUDE.md - UI2 Frontend

This file provides guidance to Claude Code when working with the UI2 React frontend code.

## Declarative API Philosophy

The Brainflow2 architecture uses a **declarative API** pattern to minimize coupling between the frontend and backend. This approach was introduced during the Rust backend refactoring to create a cleaner, more maintainable interface.

### What is the Declarative API?

Instead of the frontend making multiple imperative commands to update individual backend properties:
```typescript
// ❌ Imperative approach (old way)
await invoke('set_crosshair', { position: [10, 20, 30] });
await invoke('set_layer_opacity', { layerId: 'layer1', opacity: 0.8 });
await invoke('set_colormap', { layerId: 'layer1', colormap: 'viridis' });
await invoke('render_frame');
```

The frontend declares the complete desired state and sends it as a single object:
```typescript
// ✅ Declarative approach (new way)
const viewState = {
  crosshair: { position: [10, 20, 30], visible: true },
  layers: [
    { 
      id: 'layer1', 
      render: { opacity: 0.8, colormap: 'viridis', ... }
    }
  ],
  camera: { orientation: 'axial', zoom: 1.0, ... }
};
await invoke('apply_and_render_view_state', { state: viewState });
```

### Benefits

1. **Atomic Updates**: All state changes are applied together, preventing inconsistent intermediate states
2. **Reduced Complexity**: Frontend doesn't need to know the correct order of backend operations
3. **Better Performance**: Single RPC call instead of multiple round trips
4. **Easier Testing**: Can test with complete state snapshots
5. **Time Travel**: Enables undo/redo by storing and replaying state objects

### Implementation Details

The backend provides a single `apply_and_render_view_state` command that:
1. Deserializes the ViewState JSON
2. Updates all rendering parameters atomically
3. Renders the frame
4. Returns the rendered image as binary data

This facade pattern in Rust hides the complexity of coordinating multiple subsystems (crosshair, layers, camera, GPU resources) from the frontend.

### Frontend Architecture Alignment

The UI2 frontend is designed around this declarative API:
- Single `ViewStateStore` holds the complete view state
- All UI interactions update this central store
- A coalescing middleware batches rapid updates
- Only the latest state is sent to the backend via `requestAnimationFrame`

This creates a unidirectional data flow:
```
User Action → Service → ViewStateStore → Coalescing Middleware → Backend → Rendered Image
```

## UI2 Architecture Overview

The UI2 frontend is built with:
- **Framework**: React 18+ with TypeScript
- **State Management**: Zustand with Immer
- **Layout**: Golden Layout for dockable panels
- **Styling**: Tailwind CSS with custom theme system
- **Rendering**: Canvas elements displaying backend-rendered images
- **Backend Communication**: Tauri commands via declarative API

## Key Differences from UI (Svelte)

| Aspect | UI (Old - Svelte) | UI2 (New - React) |
|--------|-------------------|-------------------|
| Framework | SvelteKit 5 | React 18+ |
| State | Svelte stores | Zustand |
| Components | .svelte files | .tsx files |
| Reactivity | Runes ($state) | Hooks (useState) |
| Events | Custom EventBus | Zustand middleware |
| Services | Async DI | Synchronous singleton |

## Directory Structure

```
ui2/
├── src/
│   ├── components/      # React components
│   │   ├── layout/     # GoldenLayout integration
│   │   ├── panels/     # Panel components
│   │   ├── ui/         # Reusable UI elements
│   │   └── views/      # View components
│   ├── hooks/          # React hooks
│   ├── services/       # Business logic
│   ├── stores/         # Zustand stores
│   ├── types/          # TypeScript types
│   └── utils/          # Utilities
├── public/            # Static assets
└── index.html        # Entry point
```

## State Management Patterns

### ViewStateStore (Primary Store)
```typescript
interface ViewStateStore {
  viewState: ViewState;
  setViewState: (updater: (state: ViewState) => ViewState) => void;
  undo: () => void;
  redo: () => void;
}
```

### Coalescing Middleware
Batches rapid state updates to prevent overwhelming the backend:
```typescript
// Multiple rapid updates
setViewState(s => ({ ...s, crosshair: { ...s.crosshair, x: 10 }}));
setViewState(s => ({ ...s, crosshair: { ...s.crosshair, x: 20 }}));
setViewState(s => ({ ...s, crosshair: { ...s.crosshair, x: 30 }}));

// Only sends final state { crosshair: { x: 30 } } to backend
```

## Component Guidelines

### Service Pattern
All business logic lives in services:
```typescript
// ❌ Bad - Logic in component
const MyComponent = () => {
  const handleClick = async () => {
    const volume = await invoke('load_file', { path });
    useLayerStore.getState().addLayer(...);
  };
};

// ✅ Good - Use service
const MyComponent = () => {
  const layerService = useLayerService();
  const handleClick = () => layerService.loadVolume(path);
};
```

### Store Updates
Always go through services, never update stores directly in components:
```typescript
// ❌ Bad - Direct store update
useViewStateStore.getState().setViewState(...);

// ✅ Good - Service method
crosshairService.updatePosition(x, y, z);
```

## Testing Strategy

The declarative API enables powerful testing patterns:
1. **Snapshot Testing**: Save and replay complete ViewState objects
2. **Backend Mocking**: Replace `invoke` with a mock that returns pre-rendered images
3. **Time Travel Debugging**: Step through state history with undo/redo

## Performance Considerations

1. **Coalescing**: Prevents excessive backend calls during rapid interactions
2. **Memoization**: React.memo on components receiving ViewState slices
3. **Selective Updates**: Components subscribe only to relevant state slices
4. **Image Caching**: Cache rendered images by ViewState hash

## Migration Notes

When migrating from the old UI:
1. Convert Svelte stores to Zustand stores
2. Replace EventBus with Zustand subscriptions
3. Update components from .svelte to .tsx
4. Maintain the same service interfaces where possible