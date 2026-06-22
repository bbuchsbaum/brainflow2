# Set Studio Implementation Plan

**Status:** Draft  
**Date:** 2026-03-07  
**Depends on:** [Set_Studio_PRD.md](/Users/bbuchsbaum/code/brainflow2/memory-bank/Set_Studio_PRD.md)

**Update (2026-03-11):** The first implementation followed the workspace-first plan below, but current direction is shifting toward `Set Studio` as an app mode with native sidebar integration. See [Set_Studio_App_Mode_Plan.md](/Users/bbuchsbaum/code/brainflow2/memory-bank/Set_Studio_App_Mode_Plan.md) for the migration path. This document remains useful as the original modular Studio breakdown and as background for store/service responsibilities.

## 1. Purpose

This document turns the Set Studio PRD into an implementation plan for Brainflow.

The plan has four goals:
- integrate Set Studio neatly into the current Brainflow UI shell
- preserve the current renderer and layer contracts wherever possible
- define a modular, extensible UI architecture
- provide a phased implementation path that is ambitious but buildable

This is an implementation plan for the Brainflow product shell. The underlying
conceptual system remains portable.

## 2. Design Constraints

Set Studio must fit the current application architecture:
- GoldenLayout-based workspace tabs
- existing left file browser shell
- existing right sidebar stack
- current `layer -> volumeId` render contract
- current slice, mosaic, lightbox, atlas, and surface rendering systems
- current Zustand store architecture and strict selector stability rules

Set Studio must not:
- replace `ViewState` as the renderer input contract
- overload 4D time navigation semantics
- fork a second parallel rendering pipeline for volumes

Set Studio should:
- introduce a new product-level object above layers
- resolve queries and derived fields to existing renderer-native handles
- support both volume-backed and surface-backed field sets through one query and provenance model

## 3. Product Architecture

### 3.1 Product-level object model

Set Studio adds a new product layer above layers and above time navigation.

Core Brainflow-side entities:
- `FieldSetHandle`
- `FieldMemberHandle`
- `SupportHandle`
- `CohortQuery`
- `FieldExpr`
- `SummarizerSpec`
- `FacetCell`
- `LensState`
- `ProvenanceRecord`

The renderer still consumes resolved handles:
- volume handle for volume-backed output
- surface data handle for surface-backed output

The workspace thinks in:
- sets
- cohorts
- field expressions
- lenses
- provenance

The renderer thinks in:
- handles
- layers
- views

That separation is the key architectural rule.

### 3.2 Brainflow subsystem split

Set Studio should be implemented as:

- a new backend crate in `core/`
- new Tauri bridge commands in `core/api_bridge`
- a new workspace type and workspace preset in `ui2`
- a small number of new stores and services in `ui2`
- a new sidebar panel for set-level quick actions and state

Recommended crate name:
- `core/field_table`

Acceptable alternatives:
- `core/set_engine`
- `core/set_studio_core`

Recommended `ui2` namespace:
- `ui2/src/components/studio/`
- `ui2/src/services/studio/`
- `ui2/src/stores/studio/`
- `ui2/src/types/studio/`

## 4. Neat Integration with the Current UI

### 4.1 Current shell to preserve

We should preserve the current app shell:
- left file browser column
- center workspace tabs
- right sidebar stack

This means Set Studio should be introduced as a **new workspace type**, not as
a modal, not as a replacement for the main shell, and not as a special mode of
the layer panel.

### 4.2 New workspace type

Add:
- `WorkspaceType = 'set-studio'`
- `WorkspacePresetId = 'studio'`

Files likely touched:
- `ui2/src/types/workspace.ts`
- `ui2/src/types/workspacePresets.ts`
- `ui2/src/services/ViewRegistry.ts`
- `ui2/src/components/layout/GoldenLayoutWrapper.tsx`

### 4.3 Workspace layout strategy

Set Studio should integrate as a center workspace with its own internal layout.

Recommended outer integration:
- left shell column stays `FileBrowser`
- center stack gets a `SetStudioWorkspace` tab
- right shell sidebar stack gains a `SetPanel` tab

Recommended internal `SetStudioWorkspace` layout:

```text
+---------------------------------------------------------------------------+
| Toolbar                                                                   |
+----------------------+------------------------------------+---------------+
| Design / Cohorts     | Lens Canvas                        | Inspector     |
|                      |                                    | / Provenance  |
|                      |        image-first viewer area     |               |
|                      |                                    |               |
+----------------------+------------------------------------+---------------+
| Filmstrip / Cellstrip / Status                                            |
+---------------------------------------------------------------------------+
```

Recommended proportions:
- Design / Cohorts: approximately 22-26%
- Lens Canvas: approximately 56-64%
- Inspector / Provenance: approximately 14-18%

The Lens Canvas must be the dominant visual area. In Deck and Compare modes,
the viewer should feel as spacious as the app's current image-reading
workspaces rather than as a small subpanel.

This keeps:
- ingestion and quick browsing inside the current shell
- detailed querying and provenance inside the workspace
- quick set-level access in the global right sidebar

### 4.4 Right sidebar integration

Add a new sidebar tab:
- `SetPanel`

Purpose:
- quick set selection
- active set summary
- saved cohorts
- recent queries
- materialization status
- ingest/open actions

This should not duplicate the full inspector. It is a global quick-access panel.

Detailed provenance and cell/member inspection stays inside the workspace.

Files likely touched:
- `ui2/src/services/layoutService.ts`
- `ui2/src/components/layout/GoldenLayoutWrapper.tsx`
- new `ui2/src/components/panels/SetPanel.tsx`

## 5. Studio UI Modules

Set Studio should be built from stable modules rather than one giant component.

### 5.1 Top-level component tree

```text
SetStudioWorkspace
  StudioToolbar
  StudioBody
    DesignPane
    LensHost
    InspectorPane
  StudioStrip
```

### 5.2 DesignPane

Responsibilities:
- display the design table
- define filters
- define cohorts
- define group-by and facet rules
- define sort/rank rules
- manage comparator and matched-cohort options

Subcomponents:
- `SetSelector`
- `FeatureSelector`
- `DesignTablePane`
- `CohortBuilder`
- `SavedCohortsList`
- `FacetBuilder`
- `ComparatorBuilder`

### 5.3 LensHost

Responsibilities:
- manage lens tabs
- coordinate the active lens state
- host renderable outputs and drill-through

Initial lenses:
- `DeckLens`
- `CompareLens`

Later lenses:
- `PivotMatrixLens`
- `AtlasLens`
- `SimilarityLens`
- `ModelLens`

### 5.4 InspectorPane

Responsibilities:
- show active member/cell details
- show provenance
- show support and compatibility details
- expose export actions

Subcomponents:
- `ActiveObjectCard`
- `CohortSummaryCard`
- `FieldExprCard`
- `SupportCard`
- `MaterializationCard`
- `RecipeExportCard`

### 5.5 StudioStrip

Responsibilities:
- tactile browsing
- quick switching among members or cells
- fast status feedback

Modes:
- Deck mode: member strip
- Matrix mode: cell strip
- Compare mode: saved comparator strip

## 6. UI Design Rules

### 6.1 Modularity

Rules:
- each pane owns a narrow concern
- lenses are pluggable modules behind a shared interface
- no lens can directly own the global query model
- no pane can directly mutate renderer state during render

### 6.2 Extensibility

Rules:
- adding a new lens should require:
  - registering a lens type
  - implementing a lens component
  - implementing any special actions or drill behaviors
- adding a new support type should not require rewriting the query model
- adding a new reducer or statistical summarizer should not require creating a new workspace

### 6.3 Visual discipline

Rules:
- DesignPane should feel structured and table-centric, not like a property dump
- LensHost should privilege the active spatial or matrix output and visually dominate the workspace
- InspectorPane should be trustworthy, explicit, and compact
- Filmstrip should feel tactile and navigable, not decorative

### 6.4 State discipline

Rules:
- table state, lens state, and renderer state stay separate
- no inline selector objects from Zustand
- no store writes during render
- all cross-pane synchronization must be explicit through services or store actions

## 7. State and Service Architecture

### 7.1 New stores

Recommended stores:

- `useSetCatalogStore`
  - loaded field sets
  - active set id
  - ingest status
  - recent manifests

- `useStudioQueryStore`
  - active feature
  - active cohort query
  - active facet spec
  - active comparator rule
  - saved cohorts

- `useStudioLensStore`
  - active lens
  - lens-local UI state
  - active member id
  - active cell id
  - strip mode and paging

- `useDerivedFieldStore`
  - materialized field expressions
  - preview states
  - cache status for visible cells
  - multi-output derived bundles for summarizers

- `useStudioInspectorStore`
  - current provenance
  - active object details
  - exportable recipe text

### 7.2 Service layer

Recommended services:

- `SetIngestionService`
  - import from regex/glob wizard
  - import from NeuroTabs manifest
  - validation preview
  - set registration

- `SetQueryService`
  - compile cohort and facet definitions
  - request previews
  - request cell/member lists
  - validate summarizer input roles against available features

- `DerivedFieldService`
  - resolve `FieldExpr` to handles
  - manage preview vs materialized results
  - interact with cache state
  - expose bundled outputs for statistical summarizers

- `SummarizerRegistryService`
  - register supported reducers and statistical summarizers
  - surface method metadata to the UI
  - advertise required inputs and output bundle structure

- `StudioRenderAdapter`
  - adapt active lens state to current Brainflow render APIs
  - preserve camera, thresholds, colormap, overlays where valid

- `StudioProvenanceService`
  - build exportable recipes
  - expose human-readable provenance summaries

- `StudioSelectionLinkService`
  - link image selections to table selections
  - later host "Explain This Hotspot"

### 7.3 Hard boundary with current rendering

`StudioRenderAdapter` is the boundary.

It is the only Studio service that should directly translate:
- member selection
- derived field selection
- comparator selection

into:
- layer additions/removals
- handle swaps
- view updates

This keeps the Studio subsystem from leaking renderer details into the query UI.

## 8. Backend Plan

### 8.1 New backend crate

Recommended crate:
- `core/field_table`

Modules:
- `manifest/`
- `supports/`
- `registry/`
- `query/`
- `expr/`
- `summarizers/`
- `derive/`
- `provenance/`
- `cache/`

Responsibilities:
- import and validate NeuroTabs manifests compatible with the upstream NFTab table-package contract
- register sets, members, and support descriptors
- compile cohort queries
- evaluate field expressions
- validate summarizer bindings such as `field`, `beta`, `se`, `group_a`, and `group_b`
- expose provenance
- manage derived handle caching metadata

### 8.2 Keep the renderer unchanged

The new crate should not own rendering.

It should return:
- member lists
- scalar summaries
- derived field descriptors
- materialized renderer-native handles when needed

### 8.3 Tauri/API bridge additions

Likely command families:

- ingestion
  - `import_field_set_manifest`
  - `import_field_set_discovery`
  - `list_field_sets`
  - `get_field_set_info`

- query
  - `preview_cohort_query`
  - `materialize_facet_cells`
  - `get_facet_cell_members`
  - `get_cohort_summary`

- field expression
  - `resolve_field_expr`
  - `materialize_field_expr`
  - `get_field_expr_provenance`
  - `list_summarizers`
  - `validate_summarizer_inputs`

- region/table linking
  - `summarize_region_for_query`
  - `explain_region_split` later

## 9. Lens-by-Lens Build Plan

### 9.0 Statistical summarizer support

Purpose:
- allow richer field-producing operations without adding new workspace types

Requirements:
- summarizers are typed operators, not ad hoc lens modes
- summarizers declare required input roles
- summarizers may return one output field or a bundle of related fields
- lenses should be able to display either a selected output or a compact bundle chooser

Initial targets:
- two-sample t-test
- paired t-test
- fixed-effects beta/SE meta-analysis
- random-effects beta/SE meta-analysis in a later phase

### 9.1 Deck Lens

Purpose:
- browse one member or one derived field at a time

Required features:
- sort by design column
- scrub through strip
- autoplay
- pin comparator
- preserve visual state across member changes

Presentation requirements:
- one large primary viewer using existing spatial rendering components
- image area must dominate over the Design and Inspector panes
- side panes support navigation and provenance but must not compete with the viewer

Implementation note:
- same-grid member switching should resolve to handle swaps, not full pipeline resets

### 9.2 Compare Lens

Purpose:
- make cohort-relative viewing the default analytical mode

Initial panels:
- current
- comparator
- residual
- z-score

Implementation note:
- compare layouts should reuse existing multi-view and lightbox patterns where possible

Presentation requirements:
- default compare layout should be image-first
- large 2x2 or equivalent dominant multi-view presentation
- table and provenance controls remain secondary to the image panes

### 9.3 Pivot Matrix Lens

Purpose:
- map design rows/columns to live derived cells

Required features:
- categorical rows and columns
- visible-cell-first materialization
- click cell to drill
- open cell in compare or deck mode

Implementation note:
- use preview tiles and defer full-resolution materialization for off-screen cells

Presentation requirements:
- cells should be image-heavy, not text-heavy
- previews should prioritize spatial content first, metadata second
- selected cells should open into larger image-first workflows without leaving Studio

Phase:
- post-V1 expansion only

### 9.4 Atlas Lens

Purpose:
- connect regional summaries to cohorts and fields

Phase:
- v2

Implementation note:
- should reuse existing atlas loading and status infrastructure where possible

## 10. Surfaces and Support Abstraction

The UI must be modular enough to support surfaces later without a rewrite.

Rules:
- DesignPane must not assume volumetric-only concepts
- LensHost should work with an abstract render object type
- InspectorPane must show support info generically
- query, provenance, and derived expression models must remain support-agnostic

Implementation strategy:
- volume-backed output first
- surface-backed output second
- shared query model from day one

## 11. Implementation Phases

### Phase 0: Foundations

- add types for set studio entities
- add workspace type and preset
- add empty `SetStudioWorkspace`
- add `SetPanel` sidebar shell
- add stores and services as skeletons

### Phase 1: Ingestion and Deck

- manifest/discovery import
- set catalog
- design table preview
- join and alignment audit
- active set selection
- Deck Lens with sorting/filtering/scrub
- provenance basics

### Phase 2: Cohorts and Compare

- saved cohorts
- comparator rules
- current vs cohort mean
- current vs z-score
- residual map support
- drill-through from visible compare output to contributing members
- summarizer registry and validation plumbing

### Phase 3: Pivot Matrix

- row and column facet builder
- visible-cell-first materialization
- cell drill-through
- strip integration for cells
- initial statistical summarizer lens affordances

### Phase 4: Atlas and Surfaces

- atlas lens
- support-aware inspector expansion
- surface-backed field sets

### Phase 5: Region-driven analysis

- table/image bidirectional selection
- explain-this-hotspot prototype
- suggested split exploration

## 12. Acceptance Criteria

### 12.1 Architecture acceptance criteria

- Set Studio integrates as a new workspace type without replacing the current shell.
- Existing rendering contracts remain valid.
- Studio services do not write directly into render stores except through the adapter layer.
- Lenses are modular and independently evolvable.

### 12.2 UI acceptance criteria

- The workspace has distinct Design, Lens, Inspector, and Strip regions.
- Users can keep the right global sidebar open while using the internal Studio inspector.
- The workspace feels coherent and not like a collection of bolted-on subpanels.

### 12.3 Implementation acceptance criteria

- A volume-backed field set can be imported and browsed in Deck mode.
- Join and alignment audit status is visible before the user trusts the imported set.
- A cohort can be defined and reused in Compare mode.
- A user can compare a current member against a saved cohort using mean, residual, and z-score views.
- A user can drill from a visible compare result to the contributing members.
- Provenance is visible for active member and active derived cell.

### 12.4 Extensibility acceptance criteria

- A new lens can be added without changing the cohort query model.
- Surface support can be introduced without rewriting the Studio workspace shell.
- New reducers or statistical summarizers can be introduced without defining new workspace types.
- A summarizer that returns multiple outputs can be surfaced in existing lenses without changing the workspace shell.

## 13. Concrete File/Module Targets

### Likely new files

- `memory-bank/Set_Studio_Implementation_Plan.md`
- `ui2/src/components/studio/SetStudioWorkspace.tsx`
- `ui2/src/components/studio/StudioToolbar.tsx`
- `ui2/src/components/studio/DesignPane.tsx`
- `ui2/src/components/studio/LensHost.tsx`
- `ui2/src/components/studio/InspectorPane.tsx`
- `ui2/src/components/studio/StudioStrip.tsx`
- `ui2/src/components/studio/lenses/DeckLens.tsx`
- `ui2/src/components/studio/lenses/CompareLens.tsx`
- `ui2/src/components/studio/lenses/PivotMatrixLens.tsx`
- `ui2/src/components/panels/SetPanel.tsx`
- `ui2/src/services/studio/SetIngestionService.ts`
- `ui2/src/services/studio/SetQueryService.ts`
- `ui2/src/services/studio/DerivedFieldService.ts`
- `ui2/src/services/studio/StudioRenderAdapter.ts`
- `ui2/src/stores/studio/setCatalogStore.ts`
- `ui2/src/stores/studio/studioQueryStore.ts`
- `ui2/src/stores/studio/studioLensStore.ts`
- `ui2/src/stores/studio/derivedFieldStore.ts`
- `ui2/src/types/studio.ts`
- `core/field_table/`

### Likely modified files

- `ui2/src/types/workspace.ts`
- `ui2/src/types/workspacePresets.ts`
- `ui2/src/services/ViewRegistry.ts`
- `ui2/src/components/layout/GoldenLayoutWrapper.tsx`
- `ui2/src/services/layoutService.ts`
- `core/api_bridge/src/lib.rs`

## 14. Immediate Next Work Items

The first implementation tickets should be:

1. Add `set-studio` workspace type and preset.
2. Add `SetStudioWorkspace` shell component with empty panes.
3. Add `SetPanel` to the right sidebar stack.
4. Create Studio store and service skeletons.
5. Define the TypeScript types for set, cohort, field expression, facet cell, and provenance.
6. Create the backend crate scaffold for `core/field_table`.
7. Implement manifest/discovery ingestion previews.

## 15. Summary

Set Studio should be implemented as a new Brainflow workspace that preserves the
current shell, preserves the current renderer contract, and introduces a new
modular product layer above layers.

The UI should be built around four stable regions:
- Design
- Lens
- Inspector
- Strip

The implementation should be service-driven, adapter-based, and lens-modular.

That gives us something we can build incrementally now, while leaving room for
surface support, atlas summaries, matched cohorts, and region-driven
explanations later.
