<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-10 -->

# ui2/src/components

## Purpose
React components organized by feature and function. Contains all UI elements including layout management, panels, views, dialogs, and reusable UI components. Components follow a service-driven architecture where business logic is delegated to services and state is managed through Zustand stores.

## Key Files
| File | Description |
|------|-------------|
| MetadataStatusBridge.tsx | Bridges layer metadata updates to status bar |
| TooltipOverlay.tsx | Global tooltip overlay component |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| layout/ | GoldenLayout integration and workspace management |
| panels/ | Panel components (22 files): FileBrowser, Layer controls, Surface, Volume, Atlas, Cluster, Plot |
| views/ | View components (18 files): SliceViewCanvas, SurfaceViewCanvas, MosaicView, OrthogonalView |
| ui/ | Reusable UI components (shadcn/ui): Button, Dialog, Select, Slider, etc. (50+ components) |
| dialogs/ | Modal dialogs: CrosshairSettings, ExportImage, and other configuration dialogs |
| common/ | Common shared components |
| debug/ | Debug and performance monitoring components |
| tools/ | Tool components for interaction |
| annotations/ | Annotation-related components |
| analysis/ | Analysis panel components |
| plots/ | Plotting components |
| __tests__/ | Component unit tests |

## For AI Agents

### Working In This Directory
- Components are functional React components with TypeScript
- NO business logic in components - use services
- NO direct store updates - call service methods
- Use hooks for store access: `useStore(selector)`
- Use custom hooks from hooks/ for common patterns
- Follow the Panel → View → Canvas hierarchy
- Respect the two-path rendering: SliceView (viewType) vs MosaicView (tag)
- GoldenLayout creates isolated React roots - use Zustand, NOT React Context for cross-panel state
- Use Tailwind CSS for styling, custom classes in .css files only when needed
- Handle errors gracefully with user-friendly messages
- Use React.memo for performance optimization on expensive renders

### Testing Requirements
- Component tests in __tests__/ subdirectories
- Test with mock stores and services
- Test user interactions (clicks, inputs, keyboard)
- Test accessibility (a11y)
- Use testing-library for React component testing
- Mock Tauri commands
- Snapshot tests for stable UI

### Common Patterns
- Service injection: Import and call service methods directly
- Store subscription: `const value = useStore(state => state.value)`
- Event handling: EventBus.on/off for custom events
- Canvas refs: useRef for canvas elements, attach in useEffect
- Conditional rendering: Handle loading/error states explicitly
- Layout: Avoid flexbox inside Allotment panes (use absolute positioning)
- Performance: React.memo, useMemo, useCallback for optimization

## Dependencies

### Internal
- ../stores/ - Zustand state stores
- ../services/ - Business logic services
- ../hooks/ - Custom React hooks
- ../utils/ - Utility functions
- ../types/ - Type definitions
- @brainflow/api - Core API types

### External
- react, react-dom - React framework
- @radix-ui/* - UI primitives (shadcn/ui basis)
- golden-layout - Dockable panels
- three - 3D rendering (surface views)
- tailwindcss - Styling
- lucide-react - Icons

<!-- MANUAL: Components follow service-driven architecture. Business logic stays in services/. -->
