<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-10 -->

# ui2 - React Frontend Application

## Purpose
The main React/TypeScript frontend application for Brainflow2, providing an interactive neuroimaging visualization interface. Built on a declarative API architecture pattern, it uses Zustand for state management, Golden Layout for dockable panels, and communicates with the Rust backend via Tauri commands. The UI displays backend-rendered images via WebGPU for 2D slices and Three.js/WebGL for 3D surface rendering.

## Key Files
| File | Description |
|------|-------------|
| `package.json` | NPM package configuration with dependencies (React 19, Zustand, Golden Layout, Tauri API, Three.js) |
| `vite.config.ts` | Vite build configuration |
| `vitest.config.ts` | Vitest test configuration |
| `tailwind.config.js` | Tailwind CSS styling configuration |
| `tsconfig.json` | TypeScript compiler configuration |
| `index.html` | Root HTML template |
| `CLAUDE.md` | UI-specific development guidance (declarative API philosophy, architecture patterns) |
| `SURFACE_SPRINTS.md` | Surface visualization sprint planning |
| `SURFACE_VISUALIZATION_ARCHITECTURE.md` | Surface rendering architecture documentation |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `src/` | Application source code (see below for detailed breakdown) |
| `docs/` | UI documentation (FACADE_PATTERN.md, display_checklist.md) |
| `public/` | Static assets served by Vite |

### src/ Structure
| Subdirectory | Purpose |
|--------------|---------|
| `components/` | React components (MetadataStatusBridge, TooltipOverlay) |
| `stores/` | Zustand state management stores (30+ stores for layers, views, rendering, UI state) |
| `services/` | Business logic services (40+ services for loading, rendering, coordination, API) |
| `hooks/` | React custom hooks (28+ hooks for lifecycle, state, and service integration) |
| `utils/` | Utility functions (coordinates, canvas, formatting, validation) |
| `types/` | TypeScript type definitions (layers, views, surfaces, atlases, annotations) |
| `events/` | Event bus and render event channel |
| `contexts/` | React contexts (StatusContext, CrosshairContext) |

## For AI Agents

### Working In This Directory

**Critical Architecture Patterns:**
1. **Declarative API**: Send complete view state to backend via `apply_and_render_view_state`, not multiple imperative commands
2. **Zustand for Cross-Panel State**: GoldenLayout creates isolated React roots per panel, so ALL cross-panel state MUST use Zustand stores, NOT React Context
3. **Service Layer Pattern**: Business logic lives in services (`src/services/`), components are thin wrappers
4. **Coordinate System Awareness**: GPU uses Y=0 at bottom (OpenGL), CPU uses Y=0 at top (image convention). Y-flip happens at GPU buffer readback boundary only.
5. **Aspect Ratio Preservation**: Medical imaging requires square pixels. Always use uniform pixel size: `Math.max(extentX/dimX, extentY/dimY)`

**Development Commands:**
```bash
# Run full app (PREFERRED - use this, not npm run dev alone)
cd .. && cargo tauri dev

# Run UI-only dev server (limited - many features require Tauri backend)
npm run dev

# Run tests
npm test              # Vitest unit tests
npm run test:ui       # Vitest with UI

# Lint and format
npm run lint
npm run build         # TypeScript compilation + Vite build
```

**Key Development Guidelines:**
- Read `CLAUDE.md` for declarative API philosophy and architecture details
- State management: Use Zustand stores for all cross-component state
- Golden Layout isolation: Never use React Context for state shared across panels
- Service pattern: Keep components thin, logic in services
- Read `src/stores/SELECTORS_GUIDE.md` for store optimization patterns
- Read `src/stores/MIGRATION_NOTES.md` for store documentation
- Avoid flexbox inside Allotment panes (use absolute positioning instead)

**Common Tasks:**
- Adding UI components: Create in `src/components/`, use existing stores via hooks
- Adding state: Create Zustand store in `src/stores/`, use middleware for batching
- Adding business logic: Create service in `src/services/`, inject stores as needed
- Communicating with backend: Use `transport.ts` for Tauri commands, follow declarative API pattern
- Testing: Write Vitest tests co-located with source files (`.test.ts` suffix)

### Testing Requirements

**Unit Tests:**
```bash
npm test              # Run all Vitest tests
npm run test:ui       # Run with Vitest UI
```

**Test Patterns:**
- Unit tests use Vitest + Testing Library
- Mock Tauri API via `@tauri-apps/api` mocks
- Test stores independently of components
- Test services with mocked stores
- Visual regression: Use E2E tests in `/e2e/` directory

**Key Test Files:**
- `src/test-setup.ts` - Vitest configuration
- `src/utils/coordinates.test.ts` - Example coordinate system tests

### Common Patterns

**State Management:**
```typescript
// Create Zustand store in src/stores/
import { create } from 'zustand';
export const useMyStore = create<MyState>((set) => ({
  value: 0,
  increment: () => set((state) => ({ value: state.value + 1 }))
}));

// Use in component
const value = useMyStore((state) => state.value);
```

**Service Pattern:**
```typescript
// Create service in src/services/
export class MyService {
  async doWork() {
    const state = useLayerStore.getState();
    // ... business logic
    useLayerStore.setState({ ... });
  }
}
```

**Declarative Rendering:**
```typescript
// Build complete view state
const viewState = {
  crosshair: { position: [x, y, z], visible: true },
  layers: layers.map(l => ({ id: l.id, render: { opacity: l.opacity, ... }})),
  camera: { orientation: 'axial', zoom: 1.0 }
};

// Single atomic update
await invoke('plugin:api-bridge|apply_and_render_view_state', { state: viewState });
```

## Dependencies

### Internal
- `@brainflow/api` (workspace:*) - Core TypeScript interfaces and types
- Parent Rust workspace via Tauri plugin system (`plugin:api-bridge|*` commands)

### External
**Core Framework:**
- `react@19.1.0`, `react-dom@19.1.0` - UI framework
- `vite@7.0.4` - Build tool
- `typescript@5.8.3` - Type system

**State & Layout:**
- `zustand@5.0.6` - State management
- `golden-layout@2.6.0` - Dockable panel layout
- `allotment@1.20.4` - Resizable split panes

**UI Components:**
- `@radix-ui/*` - Accessible UI primitives (dialog, select, slider, etc.)
- `tailwindcss@3.4.1` - Utility-first CSS
- `lucide-react@0.525.0` - Icon library

**Backend Integration:**
- `@tauri-apps/api@2.6.0` - Tauri IPC communication

**Visualization:**
- `neurosurface` - 3D surface rendering (local dependency)
- `@visx/*` - Data visualization primitives

**Testing:**
- `vitest@3.2.4` - Test runner
- `@testing-library/react@16.3.0` - React testing utilities

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
