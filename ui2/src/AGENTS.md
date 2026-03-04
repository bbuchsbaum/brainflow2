<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-10 -->

# ui2/src

## Purpose
Main React application source code for the Brainflow neuroimaging frontend. Contains the complete UI implementation including components, state management, services, hooks, and utilities. Uses React 18+ with TypeScript, Zustand for state management, and Golden Layout for dockable panels. Communicates with Rust backend via Tauri commands using a declarative API pattern.

## Key Files
| File | Description |
|------|-------------|
| App.tsx | Root application component with error boundary, service initialization, layout root, and global UI elements |
| main.tsx | Application entry point that renders React root |
| index.css | Global styles with Tailwind CSS and custom theme |
| polyfills.ts | Browser polyfills for compatibility |
| App.css | Application-level styles |
| test-setup.ts | Vitest test configuration |
| vite-env.d.ts | Vite environment type declarations |
| debug-render-loop.js | Debug utility for detecting render loops |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| components/ | React components organized by feature (layout, panels, views, ui, dialogs) |
| stores/ | Zustand state management stores with middleware and selectors |
| services/ | Business logic and API integration layer |
| hooks/ | Custom React hooks for reusable logic |
| utils/ | Utility functions for coordinates, canvas, rendering, etc. |
| types/ | TypeScript type definitions and interfaces |
| contexts/ | React Context providers (StatusContext, CrosshairContext) |
| events/ | Custom event handling system (EventBus, RenderEventChannel) |
| __tests__/ | Unit tests for root-level components |
| styles/ | Additional style files |
| assets/ | Static assets (images, icons) |
| docs/ | Component and architecture documentation |
| tests/ | Additional test utilities |

## For AI Agents

### Working In This Directory
- Follow React best practices with functional components and hooks
- Use TypeScript strictly - no `any` types without justification
- All business logic goes in services/, not components
- State updates MUST go through services, never direct store updates in components
- Use the declarative API pattern: send complete ViewState objects to backend
- Follow the coalescing middleware pattern for rapid updates
- Respect the two-path rendering architecture (SliceView vs MosaicView)
- Use Zustand stores for cross-component state (GoldenLayout creates isolated React roots)
- Never use React Context for cross-panel state (it doesn't work with GoldenLayout)

### Testing Requirements
- Run UI tests: `pnpm --filter ui2 test`
- Run UI tests with UI: `pnpm --filter ui2 test:ui`
- Test files use Vitest framework
- Mock Tauri commands for testing
- Use snapshot testing for ViewState objects
- Test components in isolation with mock stores

### Common Patterns
- Service injection: Services are singletons, access via imports
- Store updates: `useStore.getState().method()` for non-reactive access
- Event handling: EventBus for render events, Zustand for state changes
- Tauri commands: Always go through services/apiService.ts or services/transport.ts
- Error handling: formatTauriError for user-friendly messages
- Coordinate systems: LPI world space, handle Y-flip at GPU boundary
- Component structure: Panel → View → Canvas hierarchy

## Dependencies

### Internal
- @brainflow/api - Core TypeScript interfaces and Rust type bindings
- All services depend on stores
- All components depend on services and stores
- Hooks depend on stores and services

### External
- react, react-dom - UI framework
- zustand - State management
- @tauri-apps/api - Tauri backend communication
- golden-layout - Dockable panel layout
- three - 3D surface rendering
- tailwindcss - Styling
- vitest - Testing framework

<!-- MANUAL: This is the main application source. Most development happens here. -->
