# Set Studio PRD

**Status:** Draft  
**Date:** 2026-03-06  
**Audience:** Product, design, frontend, backend, rendering, analytics  
**Scope:** Product requirements and system design for a design-aware spatial field exploration workspace

## 1. Summary

Set Studio is a new exploratory workspace for aligned spatial datasets. It treats a dataset not as "a bunch of volumes you can flip through," but as a **design-aware field table**: a collection of aligned spatial fields, indexed by metadata, queryable like a pivot table, viewable like a deck, and explorable like linked analytics.

The system must support volumetric and surface-backed fields through one coherent abstraction. The renderer may differ by support type, but the query model, provenance model, and interaction model must remain stable across implementations.

This PRD intentionally describes the system in portable terms so it can be implemented in Brainflow now and, later, adapted in other runtimes such as a browser-first JS/TS application.

## 2. Thesis

This is not a volume browser.

It is a design-aware field table:
- a collection of aligned spatial fields
- indexed by metadata rows
- queryable through filtering, grouping, faceting, ranking, and comparison
- explorable through linked table, spatial, and summary views
- capable of returning member lists, scalar summaries, or live derived fields from the same cohort definition

Internal phrases:
- `Set Studio`
- `Field Table`
- `Volumetric Pivoting`
- `Field OLAP`

## 3. Product Vision

Users should be able to:
- load a set of aligned fields and attach a design table
- browse members as a deck, strip, or ranked gallery
- define cohorts using metadata filters and grouping rules
- compute live derived fields such as cohort means, prevalence, heterogeneity, and cohort-relative maps
- apply statistical summarizers such as voxelwise t-tests or meta-analysis when the required inputs are present
- facet the dataset into a matrix of derived cells
- drill any summary back into the exact members that produced it
- move fluidly between spatial evidence and table evidence
- preserve provenance for every visible result

The system should feel like an exploratory instrument where:
- every cohort can become a map
- every map can become a cohort
- every summary can reveal its members
- every member can be interpreted relative to the right reference set

## 4. Problem Statement

Current neuroimaging workflows split the world into separate tools:
- a viewer for images
- a spreadsheet for metadata
- a statistics tool for aggregation
- a notebook for custom cohort logic

This separation slows exploratory work and hides the relationship between anatomy and design. Users can often average maps or flip subjects manually, but they cannot treat the design table and the field viewer as one interactive system.

Set Studio solves this by making the set itself a first-class object and by making cohort definitions, field expressions, and provenance visible and reusable.

## 5. Goals

### Primary goals

- Define a coherent product and domain model for design-aware spatial field exploration.
- Support both volumetric and surface-backed datasets through one abstraction.
- Make the system portable in concept and API shape across Rust and JS/TS environments.
- Provide an MVP that already feels like a new exploratory instrument, not a thin browser.

### Secondary goals

- Reuse the existing Brainflow renderer contract by resolving queries to renderer-native handles.
- Keep derivation lazy and cacheable.
- Support drill-through and provenance everywhere.

## 6. Non-Goals

- Replace Brainflow's existing layer model or 4D time navigation.
- Deliver a full statistical modeling platform in v1.
- Support arbitrary mixed-space sets at interactive speed in v1.
- Guarantee every expensive reducer is available at instant latency.
- Solve every cross-support projection workflow in the first release.

## 7. Users and Core Use Cases

### Primary users

- Neuroimaging researchers exploring subject-level and group-level maps
- Analysts comparing cohorts, sessions, contrasts, preprocessing variants, or atlas overlays
- Developers building reusable spatial analytics workflows

### Core use cases

- Browse subject-level statistical maps sorted by age, site, motion, or diagnosis.
- Compare a current subject to a matched cohort using mean, z-score, percentile, or residual views.
- Pivot a dataset by diagnosis and sex into a live matrix of cohort maps.
- Explore heterogeneity maps and drill into the specific members driving a hotspot.
- Summarize cohorts in atlas space and link ROI summaries back to spatial views.
- Run a voxelwise two-sample summary or a beta/SE meta-analysis and inspect the resulting field bundle in the same workspace.
- Use the same conceptual workflow on volume templates and cortical surface templates.

## 8. Product Principles

1. Every set is a table of fields.  
Each row is a member. Design columns are semantic axes. Group-by produces cohorts, not folders.

2. Every aggregate is drillable.  
No derived field is a dead end; users can always inspect the exact contributing members.

3. Every member has a cohort-relative view.  
The default interpretive mode is relative to a selected or matched cohort, not only the whole set.

4. Spatial selection and table selection are bidirectional.  
The table can drive the viewer, and the viewer can generate queries over the table.

5. Every view carries provenance.  
Every visible result knows its source members, filters, reducer, normalization, support, and parameters.

## 9. Conceptual Model

Set Studio introduces a product-level object above layers and above intrinsic time navigation.

### Core entities

- `SpatialFieldSet`
  - collection of members
  - design join key
  - alignment class
  - support class
  - lightweight previews and cached stats

- `FieldMember`
  - unique member id
  - handle to a raw field
  - metadata row reference
  - optional previews and QC summaries

- `DesignTable`
  - typed metadata rows keyed to members
  - categorical, numeric, ordinal, date, QC, and derived fields

- `CohortQuery`
  - filters
  - grouping
  - faceting
  - sorting
  - matching rules
  - ranking rules

- `FieldExpr`
  - expression that resolves to a field-like result
  - examples: raw member, mean of cohort, prevalence map, z-score of current vs matched cohort, residual map, t-statistic map, fixed-effects meta-analysis bundle

- `SummarizerSpec`
  - typed operator definition for reducers and statistical summarizers
  - examples: mean, variance, prevalence, two-sample t-test, paired t-test, fixed-effects meta-analysis, random-effects meta-analysis

- `Lens`
  - presentation over the result of a query
  - examples: deck, compare, pivot matrix, atlas lens, similarity lens, model lens

- `Provenance`
  - source members
  - query definition
  - reducer or summarizer
  - normalization
  - thresholding
  - support type
  - materialization/cache status

### Return-type rule

Every query over the set returns one of:
- `MemberList`
- `ScalarSummary`
- `LiveField`

This rule is central. The same cohort definition should be reusable in the viewer, in the table, and in summaries.

## 10. Support Abstraction

The system must sit above specific render targets.

### Support types

- `VolumeSupport`
  - volumetric template / space
  - orthogonal slice or volume-backed presentation

- `SurfaceSupport`
  - surface template / mesh / hemisphere
  - surface-backed presentation

- `ParcelSupport`
  - future support class for parcel-level or ROI-native data

### Requirement

The query model must be support-agnostic:
- cohort selection
- grouping
- field expressions
- provenance
- caching

Rendering may diverge by support type, but these concepts must not.

## 11. Interaction Grammar

The default grammar of interaction is:

`Select -> Group -> Summarize -> Compare -> Layout -> Drill`

Examples:
- select diagnosis == control and site == A
- group by diagnosis, sex
- summarize mean
- summarize two-sample t-test
- compare current vs matched cohort using z-score
- layout as matrix rows diagnosis, columns contrast
- drill pivot cell into member list

This grammar should shape the UI, APIs, and internal expression model.

## 12. User Experience

Set Studio is a first-class workspace, not only a sidebar.

### 12.1 Workspace regions

#### Left: Design / Cohort Panel

Purpose:
- make the set queryable

Contents:
- design table
- filters
- saved cohorts
- group-by and facet controls
- sort and rank controls
- comparator matching rules
- region-driven explanation controls when spatial selections drive the query

#### Center: Lens Canvas

Purpose:
- show the result of the active query through interchangeable lenses
- remain the dominant visual region of the workspace

Layout requirement:
- the Lens Canvas should own most of the available width and height
- the Design pane should be narrower than the Lens Canvas
- the Inspector should be narrower than the Lens Canvas and may be collapsible
- in image-first lenses such as Deck and Compare, the main viewer area should feel closer to today's reading workspace than to a small embedded panel

Recommended width allocation:
- Design / Cohort Panel: approximately 22-26%
- Lens Canvas: approximately 56-64%
- Inspector / Provenance Panel: approximately 14-18%

Initial lenses:
- `Deck`
- `Compare`
- `Pivot Matrix` as a later shipped lens
- `Atlas Lens` as a later shipped lens
- `Similarity Lens` as a later phase
- `Model Lens` as a later phase

#### Bottom: Filmstrip / Cellstrip

Purpose:
- make browsing tactile and quick

Behavior:
- in Deck mode, shows members
- in Pivot Matrix mode, shows cells or saved cohort snapshots
- in Compare mode, shows active comparator snapshots and saved references

#### Right: Inspector / Provenance Panel

Purpose:
- keep the system trustworthy and legible

Contents:
- active set
- active member or active cell
- active cohort definition
- cohort size
- reducer or summarizer and parameters
- support type
- cache / materialization status
- exportable expression or recipe

### 12.2 Required lenses

#### Deck Lens

- one member or one derived field at a time
- supports flip, scrub, autoplay, pin comparator, sort by metadata
- should present one large primary viewer using the existing Brainflow spatial rendering components
- the active image/surface viewer must be visually dominant over table and inspector controls

#### Compare Lens

- current
- comparator
- residual
- z-score
- thresholded residual

This is expected to be the everyday workhorse.

Presentation requirement:
- Compare should prioritize large image panes
- the default compare layout should feel image-first, typically as a 2x2 grid of large views or another clearly dominant multi-view arrangement
- table and provenance controls should support the image workflow rather than compete with it

#### Pivot Matrix Lens

- rows and columns from design variables
- each cell is a live field or field triptych
- users can open any cell larger and drill to source members

Presentation requirement:
- matrix cells should be image-heavy rather than text-heavy
- each visible cell should prioritize a spatial preview first, with compact metadata and drill affordances second
- selected cells should be openable into a larger compare or deck workflow without leaving the workspace

#### Atlas Lens

- rows are ROIs
- columns are cohorts or pivot cells
- image and table selections are linked

### 12.3 Region-driven explanation

A defining interaction is `Explain This Hotspot`.

Flow:
- user notices heterogeneity, residual, or an unusual region
- user clicks or brushes a voxel neighborhood or ROI
- system computes per-member summaries for that region
- system ranks metadata variables or cohort splits that explain the spread
- user can pivot immediately by the suggested factor

This is a phase 2 feature, but the architecture must support it from the start.

## 13. Product Requirements

### 13.1 Data import and joins

The system shall:
- import a set of aligned spatial fields
- import or attach a design table
- join members to design rows using a stable key
- validate support compatibility and alignment class
- expose alignment status in the UI

### 13.2 Cohort querying

The system shall support:
- filtering by metadata columns
- grouping by one or more columns
- faceting by one or more columns
- sorting and ranking
- saved cohort definitions
- reusable cohort expressions across lenses

### 13.3 Field expressions

The system shall support expressions that produce:
- raw members
- cohort reductions
- summarizer-produced field bundles
- cohort-relative maps
- thresholded variants
- support-aware summaries

Initial field expression families:
- central tendency
- heterogeneity
- cohort-relative comparison
- statistical summarization

Summarizer requirements:
- summarizers must declare required input roles such as `field`, `beta`, `se`, `group_a`, or `group_b`
- summarizers may produce one field or a bundle of related outputs
- summarizer outputs must remain drillable back to their source cohorts or members
- summarizer provenance must include method name, parameters, and required input bindings

### 13.4 Drill-through

The system shall allow the user to:
- inspect the exact members behind any derived field
- convert a derived cell back into a member list
- open member subsets in Deck or Compare mode

### 13.5 Provenance

The system shall show and export provenance for every visible result, including:
- source set
- source members
- filters and grouping
- reducer or summarizer and parameters
- normalization and comparison rules
- thresholding
- support type
- cache/materialization state

### 13.6 Performance model

The system shall distinguish:
- `Instant` interactions
- `Interactive` derivations
- `Background` derivations

Latency classes:
- Instant: next/prev, sort, scrub, switch among already-materialized comparators
- Interactive: mean, variance, prevalence, current-minus-mean
- Background: median, quantiles, clustering, embeddings, robust summaries, heavier statistical summarizers when they exceed interactive cost

### 13.7 Portability

The product model shall not depend on:
- Tauri
- Rust-specific registry patterns
- WebGPU-specific renderer assumptions

The core concepts must be portable to:
- Rust desktop applications
- browser-first JS/TS applications
- hybrid client/server systems

## 14. Brainflow Integration Requirements

Within Brainflow, Set Studio shall:
- exist as a new first-class workspace
- resolve visible field expressions to existing renderer-native handles
- preserve the current layer renderer contract
- preserve 4D intrinsic time navigation as separate from set semantics
- add a set-aware sidebar panel without making the sidebar the primary experience

Recommended Brainflow workspace components:
- `SetStudioWorkspace`
- `DesignPanel`
- `LensCanvas`
- `SetInspectorPanel`
- `SetPanel` in the right-sidebar stack

Recommended backend subsystem:
- `field_table` or `set_engine` workspace crate

Portable core, Brainflow-specific shell:
- portable: entities, query model, provenance, cache key semantics
- Brainflow-specific: handle resolution, workspace layout, renderer integration, session persistence

## 15. System Design Requirements

### 15.1 Thin data model

The set container should remain lightweight.

Each set stores:
- member references
- support compatibility class
- design join information
- lightweight stats and previews

### 15.2 Rich expression engine

Most product value sits in the query and expression engine:
- filtering
- grouping
- faceting
- matching
- reduction
- statistical summarization
- comparison
- ranking
- provenance

### 15.3 Cached derived handles

Every visible derived field should resolve to a cached renderer-native handle or equivalent runtime object.

The renderer should continue to think in terms of:
- volume handles for volume-backed output
- surface data handles for surface-backed output

### 15.4 Lazy materialization

The system must not eagerly compute all possible derived cells.

Rules:
- materialize visible cells first
- allow low-resolution previews for large matrices
- reuse cached cells across compatible lenses
- surface cache/materialization state in the UI

## 16. MVP Definition

The minimum lovable version includes:
- import of a field set and design table
- support for aligned volume-backed sets
- ingest trust UX:
  - join audit
  - unmatched rows
  - duplicate-key detection
  - alignment/support status
- Deck Lens with filtering, sorting, and scrub
- saved cohorts
- Compare Lens with:
  - current vs cohort mean
  - current vs cohort residual
  - current vs cohort z-score
- drill-through from cohort summary to members
- visible provenance in the workspace

The MVP should already feel like a new exploratory instrument.

The MVP does **not** include:
- Pivot Matrix as a shipped workflow
- Atlas Lens
- surface-backed datasets
- matched cohorts
- statistical summarizer UI beyond the compare workflow
- exportable portable recipes

## 17. Future Phases

### Phase 2

- Pivot Matrix Lens
- surface-backed field sets
- Atlas Lens
- matched cohorts
- similarity / medoids / outliers
- heterogeneity-focused maps
- statistical summarizer registry with initial t-test workflows
- Explain This Hotspot

### Phase 3

- continuous-variable effects
- model lens
- beta/SE meta-analysis and richer model-oriented summarizers
- suggested pivots and split discovery
- broader mixed-support workflows where projection semantics are explicit

## 18. Success Metrics

- Time to first valid ingest audit for a prepared set: under 60 seconds.
- Time to define and save a cohort from a prepared design table: under 2 minutes.
- Perceived member-switch latency in Deck for same-grid sets: target under 100 ms.
- Compare latency for a warm cohort mean/z-score request: target under 1.5 seconds.
- Drill-through latency from visible compare result to contributing members: target under 500 ms.
- Users can answer "what am I looking at?" from visible provenance without leaving the workspace.

## 19. Acceptance Criteria

### 19.1 Product acceptance criteria

- Users can define a cohort once and reuse it across Deck, Compare, and Pivot Matrix lenses.
- Any visible derived field can be drilled back to the exact contributing members.
- Every visible result exposes provenance without leaving the workspace.
- Users can compare a current member to a selected cohort without exporting to another tool.
- Table-driven selection changes the spatial view, and spatial selection can generate a table query or regional summary workflow.

### 19.2 MVP functional acceptance criteria

- A user can import a set of aligned fields and a design table and confirm a successful join.
- A user can inspect join and alignment audit information before trusting the imported set.
- A user can sort and filter members by metadata and browse them in Deck mode.
- A user can save a cohort definition and reuse it later in the same session.
- A user can render current vs cohort mean and current vs cohort z-score in Compare mode.
- A user can render a residual view against the active cohort.
- A user can drill from a visible cohort summary back to its contributing members.
- A user can view provenance for the active member or active derived cell.
- The system model can represent a statistical summarizer that consumes declared input roles and returns one or more field outputs without changing lens concepts.

### 19.3 Support abstraction acceptance criteria

- The domain model required to represent a set, a cohort, a field expression, a lens, and provenance does not mention Rust-only or Brainflow-only types.
- The same query concepts can describe both volume-backed and surface-backed field sets.
- A support-specific renderer can be swapped without rewriting the cohort query or provenance model.

### 19.4 Performance acceptance criteria

- For same-grid sets, switching between adjacent members in Deck mode is pointer-swap cheap from the product perspective.
- Common interactive reducers such as mean, variance, and prevalence are usable without forcing a batch precompute of the whole matrix.
- The UI exposes whether a visible result is raw, cached, in-progress, or degraded-preview.
- Heavier summarizers can be classified as background work without changing the expression model or user-visible provenance model.

### 19.5 Provenance and trust acceptance criteria

- Every visible result shows:
  - source set
  - cohort size
  - reducer, summarizer, or comparison type
  - support type
  - materialization state
- Exported recipes contain enough information to reconstruct the visible result in another implementation.

### 19.6 Portability acceptance criteria

- The conceptual API can be implemented in Brainflow now and restated in a JS/TS browser implementation without changing the core terminology.
- The PRD defines the system in terms of portable entities and workflows rather than Rust-specific runtime constraints.

## 20. Risks

- Overfitting the domain model to Brainflow's current layer system
- Letting lenses become a menu of unrelated one-off modes
- Tying field expressions too tightly to one renderer or one support type
- Making derived fields opaque and non-drillable
- Treating provenance as logging instead of product UX

## 21. Open Questions

- Final naming: Set Studio, Field Table, or another user-facing label
- Whether matched cohorts belong in MVP or Phase 2
- Whether atlas-linked summaries belong in MVP or Phase 2
- How much of the query engine should be standardized before implementation
- Which portable recipe format to use for export and interchange

## 22. Immediate Next Artifacts

The next design artifacts should be:
- a core domain spec for `SpatialFieldSet`, `CohortQuery`, `FieldExpr`, `Lens`, and `Provenance`
- an implementation plan for Brainflow workspace integration
- a strict V1 scope cut with must-ship / must-not-ship boundaries
- bead/task decomposition from this PRD

## 23. Short Description

Set Studio is a workspace where the table is not metadata attached to the images; the table is half of the microscope.
