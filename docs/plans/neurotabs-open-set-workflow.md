# Open a set: a unified Brainflow loading experience

Status: proposed implementation plan, 2026-09-06. This document does not claim that the workflow is implemented.

## The user task

Choose data, check its organization, and open it. A researcher who has navigated to a folder in Files should not have to enter that path again, invent a regex, or declare statistical roles to browse its images.

The primary journey is **Files → Open in Set Studio… → Review → Open set**. Files, folders, tables, and NeuroTabs manifests converge on one review, while retaining their different information and validation requirements.

For the supplied example, selecting `high/full` carries its remote origin into the review. The app examines `1001`, `1002`, and subsequent folders, suggests member identities, and presents recurring images as columns. These are suggestions about organization, not declarations that numbered folders are participants or images are statistical effects.

## Current implementation anchors

Inspection on 2026-09-06 establishes the following starting points:

| Existing code | Reuse and required change |
|---|---|
| `ui2/src/components/panels/FileBrowserPanel.tsx` | Has separate “Open folder as image set…” and “Create Set from Folder” actions. Carry explicit selections through one Studio entrance, while retaining the quick layer-switching image-set function. |
| `ui2/src/services/studio/SetStudioService.ts` | Separate manifest, regex, table, and folder-ontology entrances. Introduce one typed opening intent and retain adapters for existing callers. |
| `ui2/src/services/studio/SetIngestionService.ts` | Interprets import events, calls preview APIs, and guards requests by identity. Extend this orchestration rather than create another import service. |
| `ui2/src/stores/setStudio/importMachine.ts` | Existing state machine; regex defaults use root `.`, a `subject/maps/role` pattern, and required `tstat`. Replace general-entry defaults and extend draft lifecycle here. |
| `ui2/src/components/studio/StudioImportDialog.tsx` | Long modal mixes configuration, diagnostics, export, and review. Replace its default presentation with an in-workspace review; retain useful advanced controls. |
| `core/field_table/src/preview/ontology.rs` | Existing folder proposals include maps-role layouts, BIDS entities, and a flat fallback. Add generic folder/member and recurring-image organization. |
| `core/field_table/src/preview/{discovery,manifest,table}.rs` | Keep source-specific parsing and auditing; converge on a validated draft without forcing manifests through discovery. |
| `core/api_bridge/src/lib.rs` | Existing remote inventory functions use mounted sources. Extend their bounded enumeration and lifecycle rather than scanning staged cache directories. |
| `ui2/src/services/studio/importContract.ts` | UI already consumes backend `canImport` and capabilities. Preserve that authority; simplify its presentation. |

## One entrance, with explicit source choices

In Files, offer **Open in Set Studio…** for one or more selected files or folders. The context-menu action acts on the clicked item when it is outside the current selection; otherwise it uses the selected items. Drag-and-drop uses the same intent.

The Studio empty state becomes:

> **Open a set**  
> Browse images together, organize members, and compare compatible data.
>
> Choose files or folders… · Open NeuroTabs manifest… · Import table…
>
> Use selected folder: full · Open saved session… · Try an example

Show the contextual selection shortcut only when there is an eligible selection. Snapshot paths and origins when invoked, so subsequent browser navigation cannot redirect an ongoing scan. Without a source, show a chooser; never scan `.` implicitly.

Preserve quick image-set loading as **Open as switchable layer…**, with a short description that only one member is displayed at a time. It serves a different task and should not silently turn into a Studio import.

## The review screen

Use the central Studio workspace, not a second application shell or an oversized modal. Keep the Files panel available for context. The pending review temporarily occupies Studio; cancelling restores the existing study and its exact selection.

```text
Open set
trillium · …/high/full                       Change source…
Include subfolders ✓                        80 members · 3 images

Members: immediate subfolders               Change…
Images: recurring relative filenames        Change…

Member       effect.nii.gz    fit.nii.gz     residual.nii.gz
1001         Available        Available      Available
1002         Available        Missing        Available
1003         2 files…         Available      Available

2 issues to review · Unassigned files (4) · Excluded files (0)
Advanced options
────────────────────────────────────────────────────────────
Cancel                                               Open set
```

The filenames and counts above illustrate layout only; real previews must use discovered data. Source, organization controls, and footer stay visible. Only the matrix scrolls internally. Virtualize large matrices, keep member labels sticky, and provide keyboard cell navigation and a path detail drawer.

Use the shared theme and button primitives: one accent primary action, restrained secondary buttons, readable muted text, and no native shiny select/file controls. Missing and duplicate states use words/icons as well as color. At narrow widths, show a member list with expandable image entries instead of clipping columns or burying the footer.

Eliminate the one-candidate sidebar and repeated Match Summary / Import Contract / Import Notes cards. Show one concise issue summary linked to relevant cells. Keep detailed audit information available under Advanced. The action always reads **Open set**; a nearby sentence explains any restricted operations.

## Organization the user can inspect and correct

Offer three rules: one member per file, one member per folder, and match member names across selected folders. Default to the strongest supported proposal, with two or three example paths explaining it. If proposals are similarly plausible, require a choice before committing.

Use relative image paths within the chosen member folder as the conservative image identity. A basename alone must not collapse `session-1/effect.nii.gz` and `session-2/effect.nii.gz`. Token-based matching is optional and previews every resulting assignment. Label discovered image columns by their filenames until the user assigns a semantic role.

Every source must end in exactly one accounted state: assigned, explicitly excluded, unassigned, or unsupported. The user can change folder depth, edit a member or image assignment, select the file for a duplicate cell, and review exclusions. Assign stable source IDs using origin plus canonical source path, not display names. Deduplicate overlap between parent-folder and child-folder selections without merging distinct hosts or roots.

Missing cells can remain missing when browsing supports them. Duplicate assignments block the affected draft until resolved; never pick the first file silently. Participant, session, contrast, and condition remain separate fields. Repeated observations must not be collapsed merely because they share a participant identifier.

Advanced options contain filename regex, include/exclude patterns, scan limits, role mapping, and audit details. Remove the universal `tstat` prerequisite from general folder loading. Preserve explicit requirements supplied by a manifest or requested operation.

## Manifests retain their full meaning

A manifest supplies organization directly: **Choose manifest → Review declared study → Open set**. Show its name, version, observations, features, and source status. Do not ask the user to infer IDs or group files again.

Keep the parsed, supported manifest model behind the review. The visible matrix is only a projection; it must not become the serialization model. Preserve supported metadata, resource identities, relations, roles, spatial declarations, and provenance, including non-volume features. Show unsupported features precisely rather than dropping them or falling back to discovery.

If enumeration finds manifest candidates, offer **Use manifest** or **Discover images instead**. Multiple candidates require a choice. Do not merge declared and inferred organization implicitly.

For missing references, **Locate data folder…** stages a relocation mapping. Preview old/new paths, revalidate source identities and applicable content checks, and commit only to the pending draft. The original manifest is unchanged. Remote manifests resolve relative resources against their remote parent, not a local staging directory; unsupported transports receive an explicit explanation.

## Opening, validation, and remote work

Separate organization validity, source availability, and operation capability. A browseable collection need not be eligible for averaging, Welch tests, or another model. Actual comparisons retain full required source/support/role checks; sampled headers must not certify all members or anatomical registration.

Track remote work as Finding images → Organizing files → Checking image information, with real counts and cancel/retry controls. Enumeration does not fetch image payloads. State the bounded header-check policy and account for formats that require staging a compressed file to inspect its header. Full-image staging happens only when needed and remains cancellable and budgeted.

A scan budget covers visited entries, depth, elapsed work, and returned results—not just matching files. Report truncation explicitly. Never show complete population counts for a partial inventory. Offer continuation or a narrower source selection; any explicit opening of a partial inventory must retain that fact and its exclusions in provenance.

Keep each root's durable source identity separately from its current mount/session ID. Reconnect changes the access binding, not member identity. Mixed local and remote roots may fail independently; preserve the remaining inventory and all user decisions. Validate again when committing if sources or their recorded revisions changed.

## Draft and commit contract

Extend the existing import machine around four separable operations: inventory, organization, validation, and commit. Introduce a typed `OpenSetIntent` for selection, table, manifest, or saved session; source locators carry explicit local/remote identity.

The draft retains source references, inventory completeness, rules and overrides, assignments, exclusions, supported manifest data, issues, and backend capabilities. Large inventories stay behind backend handles with paged previews; React holds IDs, small view state, and result handles.

Each asynchronous result is bound to a draft ID and revision. Changing sources or grouping invalidates earlier results. Cancelling stops owned I/O and invalidates completions. Closing a destination workspace prevents late publication. Reuse existing request guards and global Zustand state across GoldenLayout roots.

**Open set** validates the exact draft revision and atomically publishes the resulting study. Failure leaves the current study untouched. No source-folder write is required. New bridge commands, if needed, follow the command-list, permissions, and generated-binding workflow; the frontend must not recreate eligibility rules.

After opening, distinguish **Save session…**, **Export NeuroTabs manifest…**, and existing saved calculation/plot artifacts. Specify session versioning and reopen behavior before exposing a session-save promise. Export uses an explicit destination and preserves durable references. Until portable remote references are supported, explain the export restriction; never serialize temporary cache paths or imply that data were copied.

## Delivery sequence and gates

| Slice | Deliverable | Required evidence |
|---|---|---|
| 1. A useful folder journey | Selected single local/remote folder → generic organization → compact review → open in memory; no regex or required statistical role. Preserve manifest/table entrances and current-study rollback. | Numbered-folder fixture with arbitrary RSA filenames opens, focuses an actual image, and preserves source origin. Cancel restores prior study. |
| 2. Editable collections | Multiple roots/files, overlapping-selection deduplication, member-depth choices, cell repairs, explicit exclusions, and drag-and-drop. | Duplicate filenames across hosts remain distinct; missing/duplicate cells are resolved without discarded observations. Keyboard and narrow-layout checks pass. |
| 3. Full manifest review | Declared organization, detected manifests, supported-feature parity, relocation, and advanced inspection in the same review. | Existing manifest fixtures retain supported semantics through import and applicable round-trip; relocation never modifies the original. |
| 4. Recovery and durable reuse | Cancellable bounded scans, reconnect/retry, continuation or explicit partial inventory, saved-session contract, deliberate export. | Interrupted remote scan preserves edits; stale completions cannot open a set; save/reopen preserves identities and grouping with no staged paths. |

Basic remote origin preservation, truthful scan limits, stale-result guards, and cancellation are requirements of slice 1 wherever those operations run. Slice 4 expands recovery and persistence rather than postponing those invariants.

## Acceptance and visual QA

Use deterministic inventories for UI tests and actual NIfTI fixtures for native integration. Include the supplied `full/1001/...` hierarchy with arbitrary filenames; flat files; nested sessions; overlapping roots; missing cells; ambiguous cells; disconnected mounts; truncated inventories; and fully supported manifests.

Playwright should run the real review components through browser-selection handoff, grouping, repair, cancellation, and opening. Capture light/dark, narrow/wide, many-row, long-path, loading, disconnected, and empty states. Verify footer visibility, focus restoration, keyboard access, and absence of horizontal page overflow. Follow browser ownership audits and close test-owned tooling. Mocked remote UI results are not live SSH acceptance.

Native tests must prove discovered source → validated set → actual focused image and, when eligible, a summary or comparison. Test failures and changed sources between preview and commit. Run manifest compatibility fixtures and bridge/permission checks for changed surfaces. A final desktop walkthrough on the user's mounted hierarchy verifies the real path; synthetic screenshots alone cannot certify it.

Completion is a researcher selecting an existing folder, understanding and correcting the proposed set, and inspecting its images without retyping a path or learning regex. Full manifest loading must remain equally direct.

## Delivery record

The first single-folder implementation and its verification boundaries are recorded in [Folder opening: first delivery](neurotabs-folder-opening-evidence.md). Multi-root editing, unified manifest review and persistence remain subsequent work.
