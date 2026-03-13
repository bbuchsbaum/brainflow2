# Set Studio App Mode Plan

**Status:** Draft  
**Date:** 2026-03-11  
**Depends on:** [Set_Studio_PRD.md](/Users/bbuchsbaum/code/brainflow2/memory-bank/Set_Studio_PRD.md), [Set_Studio_Implementation_Plan.md](/Users/bbuchsbaum/code/brainflow2/memory-bank/Set_Studio_Implementation_Plan.md)

## 1. Summary

Set Studio has outgrown the "workspace-within-a-workspace" shape used for the first implementation. The long-term design should treat Studio as an **application mode**, not only as another center tab.

Governing principle:

> One shell, two fillings.

The Brainflow shell remains stable:
- left sidebar container
- center content area
- right sidebar container
- status bar

What changes is the content that fills those slots.

## 2. Why Change

The current Studio workspace is constrained twice:
- GoldenLayout already allocates width to left and right sidebars
- Studio then subdivides the remaining center area into its own internal three-column layout

This creates three problems:
- the image viewer is squeezed below its product importance
- the inspector becomes too narrow to be genuinely useful
- Studio feels like a foreign mini-application inside Brainflow rather than a native mode

The correct long-term model is:

- **Imaging mode**
  - left sidebar: Files
  - center: orthogonal / mosaic / lightbox / surface workspaces
  - right sidebar: Volumes / Atlases / Surfaces

- **Studio mode**
  - left sidebar: Subjects
  - center: LensCanvas + StudioStrip
  - right sidebar: Details

Both modes share:
- the same data stores
- the same backend
- the same status bar
- the same shell

## 3. Product Decision

Set Studio should become a first-class app mode while preserving the existing workspace system underneath during migration.

This means:
- mode controls shell content and sidebar semantics
- workspace preset controls center layout variants within a mode
- the current focus overlay can remain as a temporary escape hatch during migration

It does **not** mean:
- deleting the workspace system
- introducing a separate Tauri window as the default Studio path
- decomposing Studio into arbitrary draggable panes

## 4. Migration Strategy

### Phase 0: Transitional Relief

Purpose:
- stop the current nested Studio layout from feeling cramped
- keep a usable full-window Studio path while the shell evolves

Deliverables:
- flexible center-column sizing inside Studio
- temporary focus-mode overlay in the app shell
- clearer return path from Studio back to the main app

This phase is transitional and should be removed after Phase 3.

### Phase 1: Shell Mode Architecture

Purpose:
- introduce `appMode` as a first-class concept above workspace presets
- make the shell aware of Studio without rewriting everything

Deliverables:
- `appModeStore`
- mode derived from active workspace type
- Studio-aware status bar bridge
- initial mode transition styling

Acceptance criteria:
- activating a `set-studio` workspace sets app mode to `studio`
- leaving the Studio workspace sets app mode to `imaging`
- status bar shows compact Studio context while in Studio mode
- no change to existing imaging workflows

### Phase 2: Sidebar Integration and State Ownership

Purpose:
- move Studio side content into the app’s native sidebars
- remove prop-drilling and giant component coordination

Deliverables:
- `StudioDesignPanel`
- `StudioInspectorPanel`
- mode-aware sidebar content
- store-owned filter/sort/scope state
- `StudioCoordinationService` for cross-pane orchestration

Acceptance criteria:
- Subjects becomes the left sidebar content in Studio mode
- Details becomes the right sidebar content in Studio mode
- SetStudioWorkspace no longer owns most query/filter/scope state locally
- cross-pane coordination works without large effect chains in the center component

### Phase 3: Thin Studio Center

Purpose:
- reduce Studio center to its real core

Deliverables:
- `SetStudioWorkspace` becomes a thin center component
- center contains:
  - thin lens bar
  - `LensCanvas`
  - `StudioStrip`
- remove the transitional focus overlay
- simplify factory/layout assumptions for Studio

Acceptance criteria:
- no internal three-column Studio layout remains
- LensCanvas gets the full center area width
- side content lives in native app sidebars
- focus overlay is no longer required

## 5. Architectural Boundaries

### 5.1 Mode vs Workspace

`appMode` and `workspace preset` are not the same thing.

- `appMode`
  - high-level operating context
  - controls sidebar semantics and status bar semantics

- `workspace preset`
  - center-area arrangement within a mode
  - remains valuable for imaging workflows

### 5.2 Store vs Service

Studio data/query state belongs in Zustand stores:
- active set
- active member
- active cohort
- filters
- sort
- scope
- import state

Studio coordination belongs in services:
- ensure current member is displayed
- refresh compare panes
- sync artifacts/provenance from current state

### 5.3 Shell vs Studio

The app shell should own:
- mode state
- sidebar content selection
- status bar semantics

Studio should own:
- cohort logic
- compare logic
- provenance logic
- import and trust UX

## 6. Phase Beads

Recommended bead sequence under `bd-3al`:

1. `bd-3al.11`
   Studio app-mode architecture PRD and migration plan

2. `bd-3al.12`
   Phase 1 shell-mode foundation:
   - `appModeStore`
   - workspace-to-mode sync
   - Studio status bridge
   - transitional focus-mode cleanup

3. `bd-3al.13`
   Phase 2 sidebar integration:
   - `StudioDesignPanel`
   - `StudioInspectorPanel`
   - mode-aware sidebar content

4. `bd-3al.14`
   Phase 2 store/service migration:
   - move local filter/sort/scope/query coordination out of `SetStudioWorkspace`
   - add `StudioCoordinationService`

5. `bd-3al.15`
   Phase 3 thin Studio center:
   - shrink `SetStudioWorkspace`
   - remove nested Studio layout
   - retire focus overlay

## 7. Immediate Recommendation

Implement Phase 1 now.

It is the lowest-risk move that starts the right architecture:
- add `appMode`
- make the status bar Studio-aware
- keep focus mode as temporary scaffolding
- do not attempt full sidebar migration in the same change

That gives Brainflow a shell-level understanding of Studio before the larger component migration begins.
