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

## Population values and linked plots

- `studio/PopulationProbePanel.tsx` uses the existing Studio state and shared `PlotEncoder`. Its service owns sampling, revision guards and mutations. Point focus does not change membership; Shift-click/keyboard selection does not resample the probe.
- `EncoderContext.datumLink` connects original point-row IDs to focus and selection. Preserve row indices when dropping unavailable measurements; do not infer identity from a filtered point index. Axes must not intercept pointer events.
- `population-harness.html` and `src/devHarness/populationHarness.tsx` exercise the real panel/encoder with synthetic values and are excluded from production entry points. This harness does not establish native sampling or brain-view acceptance.

## Live population view

- `studio/PopulationLens.tsx` uses `ReusableSliceViewport` and `SliceViewerImageSurface` directly because its service owns visible-support bitmaps instead of a registered GPU volume layer. This preserves the common placement, world-click and crosshair geometry without allocating an independent full viewer per observation.
- The population center uses intrinsic height inside Studio's scroll area; a fixed 480 px lens box overlaps controls/plots when the paired images stack on narrow windows. Keep both image identities and previous-query labels visible.
- Mean and focused observation share a stable value scale. Nonnegative descriptive summaries have their own scale. Display original observations and label the summary/exclusion unit explicitly. Participant mode must keep the focused map and gallery attached to their original observation IDs.

- `studio/PopulationCutoutGrid.tsx` composes observed cutouts from one leased sprite bitmap onto one canvas. Overlay buttons retain observation IDs for keyboard focus and selection. Cutouts stay on the pinned probe while large-view navigation moves; native sampling owns their geometry. The current UI pages 80 context observations in source order.

- `StudioCenterPane` shares one `PopulationProbeController` with the Population lens and the always-mounted values panel. The panel owns start/request/stop; the lens observes its result and requests explicit arrangements. Keep the full plot in response order while witness mode reduces only gallery previews. Avoid creating a second sampler for witness ordering.

- `studio/PopulationUnitControls.tsx` declares participant metadata and observation/single-row/within-person-mean semantics through `PopulationProbeActions`. Dataset-wide repeated rows are valid when the selected subset satisfies single-row mode. Counts distinguish selected observations from participants; incomplete metadata is a visible refusal, never an inferred identity.

- `DesignPane` pages complete keyed observation metadata in blocks of eighty rows using the current visible ID order. Page changes preserve focus and membership; changing the dataset or visible order resets paging. The import preview remains a separate compact presentation.

- `studio/PopulationMaskControls.tsx` opens the installed native dialog through the action service and offers change/clear. The common binary mask applies to population images, original focus, cutouts and probe values. Show its name and support semantics; preserve focus, selection and spatial probe when changing it. The `?mask` population harness simulates the chooser and sampling explicitly and does not establish native IPC acceptance.

- `studio/PopulationExportControls.tsx` offers full-volume summary/coverage/provenance export from a current completed Population view. Disable stale/pending/empty selections, expose cancellation and the saved directory, and retain result identity. Source validation failures require an explicit refresh; never retry with unverified source revisions.

- The Population export row also offers `Recalculate saved summary…`, independently of current-view readiness. It uses the same mounted cancellation lifecycle and reports verified completion separately from ordinary export. This recalculates into a new bundle; it does not reopen a workspace or change focus/weighting.

- Population integrates with the existing study toolbar (`PopulationOpenControls`), `StudioInspectorPanel` (`PopulationInspector`) and shared status bar. The Inspector owns participant/mask/probe/provenance settings; the lens owns image controls and a collapsed Save calculation section. Saved-source datasets expose only the Population lens because legacy materialization does not honor frozen frame bindings. Preserve matching selections across dock roots, exact arbitrary saved zoom values and select widths within narrow Inspectors. The composed Playwright harness is synthetic IPC, not native-shell acceptance.
