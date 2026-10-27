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

### Design System Reference

The UI is converging on **mockup 7 / Integrated workspace**. The canonical specification for visual style, layout, tokens, typography, and per-component contracts lives in [`../resdesign/Design.md`](../resdesign/Design.md).

Read `Design.md` before:
- Adding a new panel, dock, or workspace surface.
- Touching colors, spacing, radii, typography, or icon sizing.
- Deciding where a control belongs (one editable home per setting).
- Wiring the inspector / plot / time row / status bar / left rail.
- Auditing whether a screen matches the intended direction (use the §20 acceptance checklist).

Key invariants from `Design.md` (do not violate without reason):
- Right inspector top-level modes are `INSPECTOR | ANNOTATE` — **not** `Surface | Volume | Atlas | Annotate`.
- Inspector is selection-driven; sections vary by layer kind (volume / surface / atlas / annotation).
- `STATS` in the inspector is summary-only; the histogram chart lives in the bottom Plot dock, not the inspector.
- A 4D layer surfaces exactly one canonical pinned time row in the center workspace; do not add a second time scrubber to the inspector.
- The bottom dock is a single dock with `Activity | Plot | Clusters | Log` tabs — not separate persistent log panels.
- `Integrated` is one of `Orthogonal | Surface | Integrated | Mosaic | Compare`; it is a display-mode option, not the universal shell.
- Use the `--bf-*` token names from §3.1 of `Design.md` for new surfaces; the `--app-*` tokens in `src/styles/theme.css` map onto the same palette.

### Redesign contracts (phases 2–3, 2026-10)

The live visual contract is the root `AGENTS.md` "Visual style" section plus
`docs/plans/ui-redesign-2026-10.md`, `ui-redesign-phase2.md` and `ui-redesign-phase3.md`.
- **Primitives:** build controls from `src/components/ui/bf/` (Tabs, SegmentedControl, Slider,
  Section, FieldRow, SelectableRow, StatusPill, Chip, Button, NumberField, Modal footer, EmptyPane,
  `focusFallback`, …). The ESLint ratchet (`eslint.ratchet.js`) errors on raw palette classes,
  `text-[Npx]`, uppercase/tracking, hex in style props, raw range inputs, hand-rolled
  tablist/radiogroup and raw `var(--bf-accent)`; its allowlist may only shrink.
- **Statistics:** `LayerInfo.statistic` comes from the backend (`StatisticInfo`, NIfTI intent or SPM
  descrip); filename guesses (`zstat`/`tstat` only, never randomise p-maps or cluster masks) are
  marked `z*` everywhere and spoken "inferred from file name". Format symbols with `StatSymbol` /
  `utils/statistic.ts`. z/t maps first-paint at ±max|v| with |v| ≤ 3.1 hidden (marked as a default)
  and are never re-windowed after first paint.
- **Voxel-exact navigation:** `setCrosshair` snaps to voxel centres of the snapping reference
  (`utils/voxelSnap.ts`, bottom volume layer, `floor(v+0.5)` like the backend sampler) when
  `snapToVoxel` is on; stepping (wheel, PageUp/Down, sliders, Compare rail) moves one reference
  voxel via `SliceNavigationService`. Go-to-peak/extremum pass `{ snap: false }`. Click-to-world
  mapping is unchanged; clicks outside the volume are ignored (`clickDataBounds.ts`).
- **Label maps:** sidecar tables (BIDS dseg TSV / FreeSurfer LUT) only for layers already marked as
  labels (intent 1002 or whole-token names); slots come from `LabelColormapPool` (refcounted,
  released on layer removal).
- **Export:** one composer (`services/export/compositeExport.ts` + `compositeCapture.ts`) draws
  preview and file; text in points at output dpi; geometry tests require every text box inside
  the canvas, no overlapping text and no colorbar/image overlap. Saves go through
  `save_image_bytes` (native dialog only).
- **Clusters / readout / Compare:** `compute_clusters` + `volume_extremum` back the Clusters dock
  tab; per-layer values live in the Inspector Scene rows (`useReadoutPoint`); Compare overrides go
  through the panel-aware writer `utils/layerDisplayWrite.ts`.
- **Harness and gate:** dev-only app harness (`app-harness.html`, `src/devHarness/`) with
  synthetic known-answer fixtures (`fixtures/app/p3_fixtures.json`); screenshot gate per
  `e2e/AGENTS.md`. Update gate baselines only for intended visual changes, in the same commit.

### Working In This Directory

**Critical Architecture Patterns:**
1. **Declarative API**: Send complete view state to backend via `render_view`/`render_views`/`submit_view`, not multiple imperative commands
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
- Read `../resdesign/Design.md` for the canonical mockup-7 design system (tokens, layout, typography, per-component contracts, acceptance checklist)
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
await invoke('plugin:api-bridge|render_view', { stateJson: JSON.stringify(viewState), format: 'rgba' });
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
- `neurosurface` - npm alias for `surfview@3.1.0`; paired with `three@0.185.1`, adapted in `@brainflow/visualization`
- `@visx/*` - Data visualization primitives

**Testing:**
- `vitest@3.2.4` - Test runner
- `@testing-library/react@16.3.0` - React testing utilities

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
