<!-- Parent: ../AGENTS.md -->

# Analysis module (UI)

Runs builtin and sidecar analyses on the selected volume and opens their
outputs. Domain logic is in `core/modules/analysis` (crate `bf_analysis`), the
bridge adapter in `core/api_bridge/src/modules/analysis.rs`; sidecars are
described in `plugins/AGENTS.md`.

- **Stage: experimental, off by default** (owner decision 2026-10-31: it ships
  only demo analyses). The Rust descriptor has the same stage and version
  (`src/modules/__tests__/firstParty.test.ts`). Switched on, it appears in the
  Workspace menu, View › Workspace › Analysis and the command palette; it
  proposes no pin, no startup tab and no shortcut.
- **Contributions** (`module.ts`): command `analysis.open`, its View ›
  Workspace item, and the tool tab `analysis-workbench`. The tab id predates
  modules and is persisted, so it is a `legacyId`; never rename it.
- **Files.** `components/AnalysisWorkbenchWorkspace.tsx` (the tab; parameter
  editing and launch, the single editable home), `components/AnalysisInspector.tsx`
  (read-only summary of the selection), `services/AnalysisService.ts` (the
  bridge client and artifact opening through `@/modules/api/host`),
  `stores/analysisStore.ts` (session state, not persisted).
- **Teardown.** Switching the module off parks its tab, disposes the
  activation and calls `resetSession()`, which clears the session and drops
  responses still in flight (generation guard). The bridge cancels queued and
  running jobs in `on_disable`. Parameter drafts are kept.
- **Tests:** `__tests__/` (store, service, workbench, Inspector) stay inside
  the boundary; `../__tests__/analysis.integration.test.tsx` drives the shell
  (stage, contributions, tab, teardown, restore). The app-harness `analysis`
  scenario switches the module on first.
