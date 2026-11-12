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

- Population grouping uses existing Studio saved cohorts for references and a separate exact-ID factor partition for group cards. `PopulationBrush` commits through `PopulationProbeActions` (the range form was removed in layout C′); focus is independent. `PopulationGroupViews` consumes completed query labels/members and shared `PopulationImages` leases, never a newly requested partition's labels for an older raster. Its cards are the group-mean difference first ("G1 − G2 · 29 vs 6", computed in the UI from two group rasters on the same plane, on its own symmetric limit), one per group mean ("G1 · 29"), and "All" last (mean, one-sample t or sign share: the request's `summary`, chosen in the toolbar's Show); `fitSummaryCards` sizes them so every card fits the pane. All share one crop (`summaryCardCrop`, the montage's `montageSharedCrop`), kept across slices of one plane frame (`summaryCropKey`) and drawn double-buffered (`useCroppedCard`), with the anatomy outside the head cleared, a one-line header that is never cut, a compact bar only for a card on a scale of its own, and per-card actions in a ⋯. Comparison/difference arrangements retain A/B; contributor montage filters navigation, not working membership. Temporary exclusions stay local to `PopulationLens`, and release restores the original arrangement. Grouping is the toolbar's Group control (factor, two factors, similarity, Restore previous grouping); A/B and the test are the Inspector's Compare and test.

- Similarity (layout C′, `docs/plans/montage-toolbar-design/population-layout.md` §10): `SimilarityStrip.tsx` beside the montage grid (same React root) while Sort or Group is a similarity choice; square map, one scale on both axes; legend/glyphs from `services/studio/similarityGroupingView.ts` (the one adapter over the fit's `geometry.grouping`: Ward linkage, cuts, `bestGroups`, `clearGrouping`). Fits are requested by the montage choice (`grouping: {}`); nearest subjects, the selection centre and the unassigned list are in the Inspector. `PopulationRelationshipService` owns at most current and movie-order fit arrays outside Zustand; saved descriptors carry IDs. Lasso commits exact IDs with map-derived provenance (labelled "Exploratory selection"). Do not infer groups from the 2D positions or silently refit when a region changes. `PopulationRelationshipPanel.tsx`, `PopulationInferenceControls.tsx`, `PopulationGroupControls.tsx` and `PopulationSelectionRange.tsx` are unreferenced since C′ and await deletion.

- Compare and test (`PopulationCompareTest.tsx`, Inspector) holds the test; About the values is in Analysis setup, with readiness and mutations in `services/studio/populationInference.ts`. A test runs only on Run, on the A and B of that Run (`population.inferenceOperands`); a later selection waits for the next Run. Explicit role/units/independence declarations plus participant configuration are required. Summary's Show offers the test's channels; effect/t use diverging scales and SE/df/count separate nonnegative scales. Keep the focused raster original. Descriptive group/A-B arrangements visibly pause the question. Freeze discovery exports all channels with external source identities; it does not copy inputs or establish independent validation. Fresh channel siblings stay in `PopulationSliceService`, not Zustand, and reuse the existing source-freshness lease.

- Population statistical controls consume the native-shared catalog through `services/studio/inferenceCatalog.ts`. Method descriptions, channel choices and scales come from descriptors; no fixed t/SE/df output family is assumed. Inference runs in Inspect; descriptive group/A-B arrangements pause it. Welch references current A and B while the focused original stays independent. Reopening an inference with B restores Inspect and both participant partitions.
