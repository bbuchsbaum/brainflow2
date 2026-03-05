# Sidebar Tab QA Checklist (Phase 5.3)

Date: 2026-03-04  
Scope: `VolumeLayerPanel` tab shell (`Layers`, `Inspect`, `Mapping`, `Plots`)

## Automated Verification

- [x] Keyboard tab navigation:
  - Arrow navigation (`ArrowLeft`/`ArrowRight`)
  - Boundary navigation (`Home`/`End`)
  - Covered by `VolumeLayerPanelTabs.test.tsx`
- [x] Per-workspace tab persistence:
  - Tab selection is persisted per `activeWorkspaceId`
  - Restores previously selected tab when switching back to a workspace
  - Covered by `VolumeLayerPanelTabs.test.tsx`
- [x] Module routing per tab:
  - `Layers` -> layer table workflow
  - `Inspect` -> properties manager (`sectionMode="inspect"`)
  - `Mapping` -> properties manager (`sectionMode="mapping"`)
  - `Plots` -> embedded `PlotPanel`
  - Covered by `VolumeLayerPanelTabs.test.tsx`

## Runtime Checks Run

- `pnpm --filter temp-ui exec tsc --noEmit --pretty false` (pass)
- `pnpm --filter temp-ui test -- src/components/panels/__tests__/VolumeLayerPanelTabs.test.tsx` (pass)
- `pnpm --filter temp-ui test -- src/hooks/__tests__/useMountListener.test.ts src/components/panels/FileBrowserPanel.test.ts` (pass)

## Manual Regression Checklist

- [x] No focus trap introduced in tab shell markup (`role="tablist"`/`role="tabpanel"` with keyboard handlers).
- [x] Tab content switches without layout collapse in right sidebar (tab panel container remains scrollable within the existing panel shell).
- [x] Collapsible sections in `Inspect`/`Mapping` remain functional through `LayerPropertiesManager` section modes.

## Known Regression / Follow-up

- There is temporary duplication of plot controls:
  - Dedicated GoldenLayout `PlotPanel` still exists in the right column layout.
  - New `Plots` sidebar tab also hosts `PlotPanel`.
- Follow-up ticket: remove/merge the dedicated GoldenLayout plot pane once tabbed IA rollout is finalized.
