# Raw-Hex Backlog Triage

Snapshot date: 2026-05-02.
Source: `grep -RnoE "#[0-9a-fA-F]{6}\b" ui2/src --include="*.tsx" --include="*.ts"` (excluding `__tests__`).
Total: **220 instances** across 32 files.

This document classifies every offender into one of four categories and prescribes the action. The ESLint rule `no-restricted-syntax` (warn) in `ui2/eslint.config.js` is the working surface for this list — categories **A** and **B** are silenced via allowlist, **C** is mechanical to fix, **D** requires a token decision.

---

## Category A — Domain palettes (exempt via allowlist)

These are scientific or user-selectable palettes that intentionally ship as a fixed set of colors. They are **data**, not chrome. The allowlist already covers the `types/` and `stores/fileBrowserStore.ts` cases; the rest should be added.

| File | Count | Why exempt | Action |
|---|---|---|---|
| `components/ui/colormapOptions.ts` | 70 | Scientific colormap stops (viridis, plasma, turbo, etc.) — must match canonical colormap definitions. | **Add to allowlist.** |
| `stores/crosshairSettingsStore.ts` | 10 | User-selectable crosshair color picker presets. Exposed to the user as a discrete palette. | **Add to allowlist.** |
| `components/bids/BidsEventsTimeline.tsx` | 8 | Wong colorblind-safe categorical palette for BIDS event types. Survives on `--bf-bg-canvas`. | **Add to allowlist.** |
| `types/filesystem.ts` | 7 | File-type metadata colors. | Already exempt. |
| `stores/fileBrowserStore.ts` | 14 | File-type metadata colors. | Already exempt. |
| `types/surfaceLayers.ts` | 1 | Surface-layer default color. | Already exempt. |

**Subtotal exempted by Category A: 110 instances.**

## Category B — Annotation default colors (move to tokens)

Annotation defaults (markers, labels, ROI, measurement) are *intentionally* distinct from chrome (the orange used by `MeasurementAnnotation` is the same `#FF9500` macOS uses for selection markers). These should become a small `--bf-annotation-*` token group, not raw hex, but they are conceptually data — not chrome — until the user changes them.

| File | Count | Hexes |
|---|---|---|
| `components/annotations/MeasurementAnnotation.tsx` | 10 | `#FF9500`, `#007ACC`, `#FFA500`, `#FFFFFF`, `transparent` |
| `components/annotations/LabelAnnotation.tsx` | 8 | similar set |
| `components/annotations/ROIAnnotation.tsx` | 5 | similar set |
| `components/annotations/MarkerAnnotation.tsx` | 4 | similar set |

**Action:** introduce annotation tokens once §23.6 (iconography) and the annotation mode designs converge. Until then, **add to allowlist** with a TODO note.

**Subtotal: 27 instances.**

## Category C — Dead-code fallbacks in `var(--app-X, #fallback)`

The `var(--app-X, #fallback)` pattern was intentional defense when the alias layer was incomplete. Every `--app-*` token now has a definition in `theme.css` (verified — see §1 of `theme.css`). The fallbacks are unreachable. They can be deleted en masse with a codemod or a small follow-up PR.

| File | Count |
|---|---|
| `components/ui/ProgressDrawer.tsx` | ~6 of 14 (the `var(... , #yyyyyy)` ones) |
| `components/ui/StatusBarProgress.tsx` | 5 |
| `components/dialogs/KeyboardShortcutsDialog.tsx` | 7 |
| `components/dialogs/CrosshairSettingsDialog.tsx` | 6 |
| `components/panels/LogPanel.tsx` | 3 |
| `components/dialogs/CommandPaletteDialog.tsx` | 2 |
| `components/dialogs/GoToCoordinateDialog.tsx` | 1 |
| `components/dialogs/ImageHeaderDialog.tsx` | 2 |
| `components/TooltipOverlay.tsx` | 1 |
| `components/views/SurfaceAssociationBadge.tsx` | 2 |

**Subtotal: ~35 instances.**

**Action:** A single codemod that strips `, #[0-9a-fA-F]{6}` from inside any `var(--app-*, ...)` call. Estimated effort: 30 minutes including review. **Defer to a focused PR.**

## Category D — Real chrome violations (token replacement needed)

These are the cases the lint rule should actually catch. Each one substitutes a raw value where a `--bf-*` token already exists.

| File | Count | Example | Replacement |
|---|---|---|---|
| `utils/crosshairUtils.ts` | 2 | `#e07830`, `#808080` for default styles | `var(--bf-crosshair)` and `var(--bf-text-muted)`-equivalent (these are canvas fillStyles, so use a TS const that reads `getComputedStyle(document.documentElement).getPropertyValue('--bf-crosshair')` once at boot). |
| `components/panels/ActivityPanel.tsx` | 7 | `#d1d5db`, `#60a5fa`, `#111827`, `#94a3b8` | `text-bf-text-secondary`, `text-bf-accent`, `bg-bf-bg-canvas`, `text-bf-text-muted`. |
| `components/ui/LayerRow.tsx` | 3 | `#f59e0b`, `#10b981`, `#3A3A3A` | `var(--bf-warning)`, `var(--bf-success)`, `var(--bf-bg-hover)`. |
| `components/dialogs/CrosshairPreview.tsx` | 3 | preview hexes | likely user-color preview; review case-by-case. |
| `components/views/SurfaceViewCanvas.tsx` | 2 | canvas fillStyles | introduce a small `surfaceCanvasColors` const that reads tokens. |
| `components/panels/FileBrowserPanel.tsx` | 2 | UI hexes (not data) | tokens. |
| `components/dialogs/ImageHeaderDialog.tsx` | 2 | header chrome hexes | tokens. |
| `services/apiService.ts` | 5 | canvas placeholder background `#2a2a2a`, `#1a1a1a`, `#401010`, `#ff8080` | error placeholder canvas — introduce `--bf-canvas-error-bg` / `--bf-canvas-error-text` tokens. |
| `stores/surfaceStore.ts` | 3 | surface material defaults `#CCCCCC`, `#ffffff`, `#000000` | acceptable as material defaults; document or move to a `materialDefaults.ts` (Category A). |
| `components/plots/HistogramChart.tsx` | 4 | `#000000`, `#ffffff` monochrome anchors | acceptable but reference `var(--bf-bg-canvas)` / `var(--bf-text-primary)` once tokens are exposed via `getComputedStyle`. |
| `components/bids/BidsValidationPanel.tsx` | 4 | severity color hexes | use semantic tokens. |
| `components/ui/TestProgress.tsx` | 2 | test artifact hexes | low priority; remove file if test-only. |
| `components/ui/StatusBarProgress.tsx` | (overlap with C) | | |

**Subtotal Category D unique: ~37 instances.**

---

## Aggregate

| Category | Action | Approx count |
|---|---|---|
| A — domain palettes | Allowlist (move to exempt) | 110 |
| B — annotation defaults | Allowlist with TODO; tokenize later | 27 |
| C — `var(... , #fallback)` dead code | Codemod-strip in a focused PR | ~35 |
| D — real chrome violations | Token substitution per file | ~37 |
| Test files (`__tests__/`) | Already excluded | ~11 |
| **Total** | | **~220** |

After Category A and B are added to the allowlist, the lint rule surfaces **~72 real targets**, dominated by Category D. That is a reviewable, working list.

---

## Recommended sequencing

1. **This PR** — extend the ESLint allowlist with the Category A files. Result: lint output drops by 110 instances.
2. **Follow-up PR #1 (small)** — codemod-strip Category C dead-code fallbacks. Result: another ~35 disappear.
3. **Follow-up PR #2 (focused)** — fix Category D one folder at a time: `panels/`, then `dialogs/`, then `ui/`. Each file introduces or reuses a `--bf-*` token. Result: backlog reaches 0.
4. **Promote the lint rule from `warn` to `error`** once Category D is empty.
5. **Open a separate spec** for the `--bf-annotation-*` and `--bf-canvas-error-*` token groups before unwinding Category B and the apiService canvas placeholders.

The sequencing is intentional: each step measurably reduces the warning count, and any step can stop without leaving the codebase worse than before.
