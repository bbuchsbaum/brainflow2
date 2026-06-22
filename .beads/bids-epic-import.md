# BIDS Explorer Workspace

- type: feature
- priority: 1
- labels: epic,bids,v1

## Description

A research-grade BIDS dataset explorer workspace integrated into Brainflow2. When a researcher opens a BIDS directory, they should understand the entire dataset — structure, completeness, demographics, task designs — within seconds.

## Acceptance Criteria

- [ ] User can open a BIDS-compliant directory and see a full dataset summary within the Brainflow2 workspace system
- [ ] Coverage matrix shows subject × session × modality completeness at a glance
- [ ] Events timeline visualizes fMRI task designs per run
- [ ] Validation panel surfaces BIDS compliance issues
- [ ] User can click any file in the coverage matrix and open it in the volume/surface viewer
- [ ] Works on remote-mounted datasets
- [ ] Zero new npm dependencies (uses existing Visx, Lucide, Tailwind)
- [ ] Follows existing Bauhaus instrument aesthetic and design principles: typography over decoration, spacing over boxes, color is state not style

---

# Add bids-rs workspace dependency

- type: task
- priority: 1
- labels: bids,backend,v1

## Description

Add the bids-rs crate (private git repo: github.com/bbuchsbaum/bids-rs) as a workspace dependency so api_bridge can use BidsProject, SearchBuilder, EventData, ComplianceChecker, etc.

## Acceptance Criteria

- [ ] `Cargo.toml` root workspace lists `bids-rs = { git = "ssh://git@github.com/bbuchsbaum/bids-rs.git", branch = "main" }`
- [ ] `core/api_bridge/Cargo.toml` depends on `bids-rs.workspace = true`
- [ ] `cargo check --workspace` passes
- [ ] No version conflicts with existing nalgebra, serde, walkdir deps

---

# Define BIDS bridge types in core/bridge_types

- type: task
- priority: 1
- labels: bids,backend,types,v1

## Description

Create `core/bridge_types/src/bids.rs` with lean serializable types for the V1 UI. All types derive `Serialize, Deserialize, TS` for auto-generation. Add `export_all()` calls in `export_types.rs`. Frontend consumes generated types via `@brainflow/api`, not hand-mirrored duplicates.

Types needed: BidsDatasetSummary, BidsCoverageMatrix, BidsCoverageColumn, BidsCoverageCell, BidsParticipantRow, BidsTaskDesign, BidsEventRow, BidsValidationResult, BidsValidationIssue.

## Acceptance Criteria

- [ ] `core/bridge_types/src/bids.rs` defines all 9 types with `#[derive(TS)]`
- [ ] `core/bridge_types/src/lib.rs` re-exports via `mod bids; pub use bids::*;`
- [ ] `core/bridge_types/src/bin/export_types.rs` has `export_all()` for each new type
- [ ] `cargo xtask ts-bindings` generates valid TypeScript interfaces into `@brainflow/api`
- [ ] No UI-specific state (selection, filters) in bridge types — those stay in the store
- [ ] Subject IDs use bare format (no `sub-` prefix), matching bids-rs convention

---

# Implement scan_bids_dataset Tauri command

- type: task
- priority: 1
- labels: bids,backend,v1
- estimate: 480

## Description

The primary backend command that scans a BIDS directory and returns a complete BidsDatasetSummary. Must call `materialize_remote_file_if_needed()` for every file read to support remote-mounted datasets. Uses bids-rs BidsProject::new(), summary(), search_files(), read_all_events(), ComplianceChecker.

Register in all 4 places: lib.rs function, build.rs COMMANDS, main.rs generate_handler!, transport.ts apiBridgeCommands.

## Acceptance Criteria

- [ ] Command defined with `#[command]` and `#[tracing::instrument]` in lib.rs
- [ ] Registered in build.rs COMMANDS array
- [ ] Registered in main.rs generate_handler![] macro
- [ ] Registered in transport.ts apiBridgeCommands
- [ ] Calls `materialize_remote_file_if_needed()` for dataset_description.json, participants.tsv, and each sidecar/events file read
- [ ] Returns BidsDatasetSummary with coverage matrix, participants, task designs, validation
- [ ] Returns absolute file paths in BidsCoverageCell.file_paths
- [ ] Returns clear BridgeError::Input with code 3001 when directory is not valid BIDS
- [ ] Error message specifies which required file is missing (dataset_description.json or participants.tsv)
- [ ] Unit test with fixture BIDS directory in test-data/

---

# Implement get_bids_events Tauri command

- type: task
- priority: 2
- labels: bids,backend,v1

## Description

On-demand command to load events.tsv for a specific subject/task/session/run combination. Used by the events timeline when user drills into a specific functional run. Must also call materialize_remote_file_if_needed().

Register in all 4 places.

## Acceptance Criteria

- [ ] Accepts dataset_path, subject, task, optional session, optional run
- [ ] Returns Vec<BidsEventRow> with onset, duration, trial_type, additional columns
- [ ] Calls materialize_remote_file_if_needed() on the events.tsv path
- [ ] Returns empty vec (not error) when no events file exists for the query
- [ ] Registered in all 4 places (lib.rs, build.rs, main.rs, transport.ts)
- [ ] Subject parameter uses bare ID (no sub- prefix)

---

# Implement check_bids_directory Tauri command

- type: task
- priority: 2
- labels: bids,backend,v1

## Description

Lightweight command that checks if a directory contains both dataset_description.json and participants.tsv. Used by the file browser context menu to conditionally show "Open as BIDS Dataset". Does NOT load or parse anything — just two existence checks. Bypasses the fileBrowserStore extension filter problem entirely.

## Acceptance Criteria

- [ ] Returns bool — true only if BOTH marker files exist
- [ ] Does not parse or validate any file content
- [ ] Fast enough for context menu display (<10ms for local paths)
- [ ] Registered in all 4 places

---

# Create bidsStore Zustand store

- type: task
- priority: 1
- labels: bids,frontend,store,v1

## Description

New Zustand store at `ui2/src/stores/bidsStore.ts` managing BIDS dataset state. Uses subscribeWithSelector + immer pattern matching fileBrowserStore and layerStore. UI-only types (selection, filters, tab state) defined locally. Backend types imported from @brainflow/api.

## Acceptance Criteria

- [ ] Uses `subscribeWithSelector(immer(...))` middleware stack
- [ ] Calls `enableMapSet()` for Map-based eventsCache
- [ ] `scanDataset(path)` action invokes scan_bids_dataset command, updates summary + status
- [ ] `loadEvents(subject, task, session?, run?)` invokes get_bids_events, caches in eventsCache Map
- [ ] Selection state: subjectId, sessionId, modality (all nullable)
- [ ] activeDetailTab: 'events' | 'validation'
- [ ] scanStatus: 'idle' | 'scanning' | 'ready' | 'error' with scanError string
- [ ] reset() clears all state
- [ ] No persistence middleware — BIDS state is ephemeral
- [ ] Subject IDs stored as bare format; `formatSubjectId()` helper in `ui2/src/utils/bids.ts`

---

# Register bids-explorer workspace type

- type: task
- priority: 1
- labels: bids,frontend,workspace,v1

## Description

Wire up the new workspace type through the existing registration chain. No preset, no shortcut, no sidebar changes. V1 is opened programmatically only.

## Acceptance Criteria

- [ ] `'bids-explorer'` added to WorkspaceType union in `ui2/src/types/workspace.ts`
- [ ] WORKSPACE_METADATA entry: `{ category: 'analysis', name: 'BIDS Explorer', singleton: true }`
- [ ] BidsExplorerFactory created in ViewRegistry.ts implementing ViewFactory
- [ ] `case 'bids-explorer':` added to component switch in GoldenLayoutRoot.tsx
- [ ] `workspaceStore.createWorkspace('bids-explorer')` creates and activates workspace
- [ ] Singleton enforced — second create call activates existing, does not duplicate
- [ ] No changes to workspacePresets.ts, no keyboard shortcuts, no sidebar registration

---

# Add BIDS detection to file browser context menu

- type: task
- priority: 2
- labels: bids,frontend,integration,v1

## Description

When right-clicking a directory in FileBrowserPanel, call check_bids_directory on the Rust side. If true, show "Open as BIDS Dataset" context menu item that creates/activates the bids-explorer workspace and triggers scanDataset(). This bypasses the filtered browser tree entirely — detection happens on the raw filesystem via Tauri command.

## Acceptance Criteria

- [ ] Context menu for directories calls check_bids_directory command
- [ ] "Open as BIDS Dataset" menu item appears only when check returns true
- [ ] Clicking it calls `workspaceStore.createWorkspace('bids-explorer')` then `bidsStore.scanDataset(path)`
- [ ] Does not modify fileBrowserStore extension filter
- [ ] Does not add .json or .tsv to NEUROIMAGING_EXTENSIONS allowlist

---

# Design and build BidsExplorerWorkspace container

- type: task
- priority: 1
- labels: bids,frontend,design,v1
- estimate: 240

## Description

Top-level workspace component at `ui2/src/components/bids/BidsExplorerWorkspace.tsx`. Follows SetStudioWorkspace pattern: shows BidsEmptyState when no dataset loaded, otherwise renders summary strip → coverage matrix → detail tabs. Must match existing Bauhaus instrument aesthetic.

Design principles: The interface is a contract, not a canvas. Typography over decoration. Spacing over boxes. Color is state, not style.

## Acceptance Criteria

- [ ] Shows BidsEmptyState when bidsStore.summary is null
- [ ] Shows loading state with progress indicator when scanStatus is 'scanning'
- [ ] Shows error state with retry button and clear message when scanStatus is 'error'
- [ ] Renders BidsSummaryStrip + BidsCoverageMatrix + BidsDetailTabs when scanStatus is 'ready'
- [ ] Uses absolute positioning within container (Allotment-safe)
- [ ] All spacing from 4px grid (8, 12, 16, 24, 32px)
- [ ] Content width constrained — coverage matrix can be full-width, text sections ≤860px
- [ ] Error state explains what went wrong AND what to do (task-forward): e.g. "Missing participants.tsv. BIDS datasets require this file."
- [ ] Empty state is task-forward: explains what BIDS is, what fills the view, primary action is "Open BIDS Dataset" directory picker
- [ ] No decorative shadows, no accent colors without semantic meaning
- [ ] Dark mode support via CSS custom properties

---

# Design and build BidsEmptyState

- type: task
- priority: 2
- labels: bids,frontend,design,v1

## Description

Empty state shown when no dataset is loaded. Must be task-forward per design principles: explain why empty, what would fill it, primary action resolves the state.

## Acceptance Criteria

- [ ] Explains what a BIDS dataset is (one sentence)
- [ ] Explains what the workspace shows when a dataset is loaded
- [ ] Primary CTA: "Open BIDS Dataset" triggers native directory picker dialog
- [ ] Secondary: drag-drop a directory onto the workspace
- [ ] Uses bf-role-section and bf-role-body typography
- [ ] No decorative illustrations, no emojis, no cute copy — technical writing tone
- [ ] Centered within workspace, content width ≤720px

---

# Design and build BidsSummaryStrip

- type: task
- priority: 1
- labels: bids,frontend,design,v1

## Description

Horizontal row of summary cards showing dataset metrics at a glance. Uses existing PropertyBox pattern from PropertyRow.tsx. Must communicate dataset identity in <2 seconds of scanning.

## Acceptance Criteria

- [ ] Displays: Subjects (count), Sessions (count or "none"), Tasks (names as inline text), Modalities (list), Size (formatted bytes), Validation (status dot + summary)
- [ ] Uses PropertyBox with bf-role-section headers (uppercase, 11px, 600 weight)
- [ ] Values in bf-role-value monospace (13px, tabular-nums)
- [ ] Validation uses status dot pattern: ● Passed (green), ● N warnings (amber), ● N errors (red)
- [ ] All metadata same visual weight — no hierarchy within the strip
- [ ] Horizontal layout, wraps gracefully on narrow widths
- [ ] Cards grouped with space, not boxes — 1px hairline border OR pure spacing
- [ ] All spacing from 4px grid
- [ ] formatSubjectId() not needed here — just show count

---

# Design and build BidsCoverageMatrix

- type: task
- priority: 1
- labels: bids,frontend,design,v1
- estimate: 480

## Description

The hero visualization — a subject × (session × modality) grid showing data completeness. Pure CSS grid + Visx scales, no new dependencies. This is the single highest-value view in the workspace.

Design principles: Color is state. Green = present, orange = partial, hatched gray = missing. No decorative color.

## Acceptance Criteria

- [ ] Rows: subjects, labeled with formatSubjectId(id), sticky left column
- [ ] Columns: grouped by session → modality/suffix, sticky header row
- [ ] Column headers use bf-role-section uppercase typography
- [ ] Cell colors are semantic: present = hsl(var(--primary)) cyan, partial = hsl(var(--accent)) orange, missing = hsl(var(--muted)) with CSS diagonal hatch
- [ ] Hover tooltip shows: file count, total size, file paths — using @visx/tooltip
- [ ] Click cell updates bidsStore.selection (subjectId, sessionId, modality)
- [ ] Selected cell has 1px solid border highlight, not background change
- [ ] "Open in Viewer" affordance on click for present cells — calls getFileLoadingService().loadFile(path, 'bids-explorer', 'new-workspace')
- [ ] Handles 50+ subjects without scroll jank (CSS contain: strict on rows)
- [ ] Session group headers span columns with 1px bottom border separator
- [ ] No decorative shadows on cells
- [ ] 4px gap between cells, 8px between column groups
- [ ] Responsive: horizontal scroll when columns exceed viewport, scrollbar styled

---

# Design and build BidsDetailTabs

- type: task
- priority: 2
- labels: bids,frontend,design,v1

## Description

Tab container below the coverage matrix with two V1 tabs: Events Timeline and Validation. Uses text-based tab selector, not heavy tab bar.

## Acceptance Criteria

- [ ] Two tabs in V1: "Events" and "Validation"
- [ ] Active tab indicated with bottom border accent, not background fill
- [ ] Tab labels use bf-role-section typography
- [ ] Tab content area has 16px top padding
- [ ] Events tab lazy-loads: calls bidsStore.loadEvents() only when a functional cell is selected
- [ ] If no functional cell selected, Events tab shows inline message: "Select a functional run in the coverage matrix to view its event timeline"
- [ ] Smooth 200ms transition between tabs

---

# Design and build BidsEventsTimeline

- type: task
- priority: 2
- labels: bids,frontend,design,v1
- estimate: 480

## Description

Visx swimlane timeline visualizing events.tsv data for a selected functional run. One horizontal lane per trial_type, colored rectangles from onset to onset+duration. Uses existing @visx/axis, @visx/scale, @visx/shape dependencies.

Design principles: Color is state — each trial_type gets a deterministic color from the Okabe-Ito palette. No decorative elements. Axis labels are technical writing.

## Acceptance Criteria

- [ ] One horizontal swimlane per unique trial_type value
- [ ] Each event rendered as a rectangle: x = onset, width = duration (in seconds)
- [ ] Zero-duration events rendered as 2px vertical tick marks
- [ ] Time axis (x) with labeled ticks at sensible intervals (every 10s, 30s, etc.)
- [ ] Trial type labels on y-axis, left-aligned, bf-role-label typography
- [ ] Color palette: Okabe-Ito 8-color array, assigned deterministically from trial_type string hash
- [ ] Baseline/fixation conditions mapped to neutral gray regardless of hash
- [ ] @visx/tooltip on hover: onset (s), duration (s), trial_type, response_time if present
- [ ] Lane height: 24px per trial_type, 4px gap between lanes
- [ ] Time axis uses tabular-nums monospace for tick labels
- [ ] No gridlines — only axis lines at 0.5px in border-subtle color
- [ ] Horizontal scroll or zoom for runs >120s (brush interaction deferred to V1.1)
- [ ] Handles overlapping events within same trial_type via opacity stacking (60% alpha)

---

# Design and build BidsValidationPanel

- type: task
- priority: 2
- labels: bids,frontend,design,v1

## Description

Displays BIDS compliance issues from ComplianceChecker. Uses existing CollapsibleSection and Badge UI primitives.

Design principles: Errors are prominent and actionable. Show what went wrong AND how to fix it. Status dots for severity.

## Acceptance Criteria

- [ ] Issues grouped by severity using CollapsibleSection: Critical, High, Medium, Low
- [ ] Each issue shows: severity dot (red/orange/amber/gray), description, file path if applicable
- [ ] File paths are clickable — emit filebrowser.file.open event to navigate
- [ ] Critical section expanded by default, others collapsed
- [ ] If validation.passed is true, show: "● Passed — No issues found" in green
- [ ] Count badge in section header: "Critical (3)"
- [ ] Issue text uses bf-role-body typography
- [ ] File paths in monospace
- [ ] No dismiss buttons — issues persist until resolved
- [ ] Empty sections hidden (don't show "Low (0)")

---

# Integration: open BIDS files in volume/surface viewer

- type: task
- priority: 1
- labels: bids,frontend,integration,v1

## Description

Wire up the coverage matrix cell click → viewer flow. When user clicks a present cell and chooses to view the file, call getFileLoadingService().loadFile() which enters the existing 52-step loading pipeline unchanged.

## Acceptance Criteria

- [ ] Clicking a present cell shows an "Open" action (button or context menu)
- [ ] "Open" calls `getFileLoadingService().loadFile(cell.file_paths[0], 'bids-explorer', 'new-workspace')`
- [ ] NIfTI files open in a new orthogonal-locked workspace tab
- [ ] GIfTI surface files open in surface viewer panel
- [ ] GIfTI overlay files (.func.gii) load as surface overlays
- [ ] Loading errors display as notifications via existing eventBus pattern
- [ ] Multiple files in a cell (e.g., multi-run) show a list to pick from

---

# Test suite for BIDS Explorer V1

- type: task
- priority: 2
- labels: bids,testing,v1

## Description

Unit and integration tests for the BIDS Explorer feature.

## Acceptance Criteria

- [ ] Rust: scan_bids_dataset unit test with fixture BIDS directory in test-data/bids-fixture/
- [ ] Rust: get_bids_events unit test returning correct event rows
- [ ] Rust: check_bids_directory returns false for non-BIDS dirs
- [ ] Vitest: bidsStore scan/select/reset cycle with mocked transport
- [ ] Vitest: BidsCoverageMatrix renders correct cells from mock summary
- [ ] Vitest: BidsEventsTimeline renders correct swimlanes from mock events
- [ ] Vitest: BidsValidationPanel renders grouped issues
- [ ] All existing tests still pass (`cargo test --workspace` + `pnpm --filter ui2 test`)
