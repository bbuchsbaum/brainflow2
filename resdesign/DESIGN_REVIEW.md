# DESIGN.md — Vetting Review

Reviewer: ui-design-discipline + frontend-design pass.
Subject: `resdesign/Design.md` (mockup-7 / Integrated workspace direction).
Verdict: **Excellent foundation, ship it as v1 with the addendum below.** The doctrine is unusually disciplined for a research tool, and the most important design decisions (one editable home per control, layers as source of visual truth, plot as first-class dock, integrated as a *mode*) are correctly hoisted to the top.

---

## 1. What the spec gets right

- **Hierarchy.** Principles → layout → tokens → typography → base → components → state contracts → acceptance checklist. Each layer pushes decisions to the right place.
- **Doctrine.** §1.4 ("one editable home per control") is the single most valuable rule for a tool with this many overlapping affordances. The control/canonical-location table is a real contract, not aspirational text.
- **Selection-driven inspector.** Refusing the `Surface | Volume | Atlas | Annotate` antipattern in §1.3 prevents the most common medical-imaging UI rot.
- **Numerics.** Tabular numerals are mandated everywhere they matter (§4.3) — coordinates, voxel indices, intensities, frame counters, plot axes. This is non-negotiable for research tools and the spec gets it right.
- **Canvas accuracy.** §8.3 explicitly forbids CSS-stretch on rendered images and pins canvas backing-store sizing to `cssSize × devicePixelRatio`. This catches the single most common rendering bug in medical apps.
- **Acceptance checklist.** §20 is testable. Each item maps to either a visible affordance or a forbidden pattern.

## 2. Gaps to address before declaring v1 final

These are not blockers — they should be added as a short addendum (§23+) or folded into the existing sections.

### 2.1 Z-index scale (missing)
The spec defines panels, dock, tool rail, popovers, and toasts but never agrees on stacking order. Add a token block:
```css
--bf-z-base: 0;
--bf-z-panel: 1;
--bf-z-overlay: 10;     /* canvas overlays, R/L labels, rulers */
--bf-z-tool-rail: 20;
--bf-z-popover: 100;    /* Radix Popover, DropdownMenu */
--bf-z-tooltip: 200;
--bf-z-modal: 1000;
--bf-z-toast: 2000;
--bf-z-drag: 3000;      /* DnD-kit overlay */
```

### 2.2 Component contracts that aren't yet contracted
The Design currently leaves these to "whatever Radix gives us":
- **Dialog / Modal** — sizing, padding, header/footer rhythm, dismissal behavior.
- **Tooltip** — when to use vs popover, keyboard reachability, delay.
- **Toast / Notification** — already a real component (`NotificationToast.tsx`); needs slot in §13.
- **Tabs (general)** — only dock and inspector tabs are contracted; analysis workbench tabs follow no rule.
- **Tables / lists** — analysis results, BIDS metadata, atlas labels.
- **Loading / skeleton** — only `ProgressDrawer` referenced; specify skeleton vs spinner vs progress for each surface.
- **Empty states** — only `EmptyInspector` mentioned; the bottom dock, file browser, and analysis workbench all need empty-state contracts.

### 2.3 Variant coverage on `bf-button`
§14.1 defines `.bf-button` and `.bf-button-primary`. Add (kept short — these will be expressed as variants, not classes):
- `secondary` (default)
- `primary`
- `ghost` (no border, no background)
- `destructive` (uses `--bf-danger`)
- `icon` (square, no padding)

Add explicit sizes: `xs (24px)`, `sm (28px = current default)`, `md (32px)` matching `--bf-control-*` tokens.

### 2.4 Form validation styling
Inputs (§14.2) only define `:focus`. Add:
- `[aria-invalid="true"]` → `border-color: var(--bf-danger)` and `box-shadow` ring.
- Help text and error text typography roles.
- Disabled state (`opacity` or `--bf-text-faint`).

### 2.5 Plot palette for multi-series
Only one `--bf-plot-line` is defined. ROI time-series, event-aligned response, and QC traces all need 6–8 perceptually-distinct colors that survive on `--bf-bg-canvas`. Recommend a categorical scale aligned with the anatomical orientation hue family (blue/green/orange) plus magenta/cyan/yellow secondaries.

### 2.6 Iconography
The spec uses icons everywhere (eye, lock, ruler, brush) but never says:
- Source: `lucide-react` already in deps — call it out as canonical.
- Size: `14px` inside `bf-control-sm`, `16px` inside `bf-control` — match the typography baseline.
- Stroke: 1.5–1.75 px, never filled mixed with stroke.

### 2.7 Cursor states
Medical tools imply specific cursors (crosshair while measuring, brush, lasso, grab/grabbing for pan). Document them. Without this rule, every viewport will reinvent cursor swapping.

### 2.8 Accessibility / contrast notes
The dark research palette must still meet WCAG AA on text:
- `--bf-text-primary` on `--bf-bg-app` ✓ ~14.6:1
- `--bf-text-secondary` on `--bf-bg-panel` ✓ ~9.5:1
- `--bf-text-muted` on `--bf-bg-panel` ✓ ~5.0:1 (passes AA)
- `--bf-text-faint` on `--bf-bg-panel` — **fails AA** (~3.4:1). Reserve only for non-essential metadata.

Add a one-line rule: "tokens prefixed `*-faint` are decorative; never use them for content the user must read."

### 2.9 Density / responsive baseline
1600 × 1000 is the design baseline, but the bottom dock and surface viewport will get squeezed badly below 1280 wide. State the **minimum supported** size (recommend 1280 × 800) and what collapses first (left rail → drawer; bottom dock → 160 px min).

### 2.10 Print / screenshot rule
Brainflow exports figures. Add: "Anything that ships in `Capture` (§10.2) must render with all crosshair, ruler, and legend overlays enabled by default; exported PNG/SVG must use `--bf-bg-canvas` as background, never the panel chrome."

### 2.11 Decision log location
Design.md will accumulate decisions over time. Reserve §22 as the *preserved* doctrine and add a §23 `Decision Log` for date-stamped amendments. Without this, the spec will drift silently.

## 3. What to NOT change

Keep the dark, dense, research-grade aesthetic. Resist any temptation to:
- Add color-by-feature — Brainflow is read-mostly, not a Notion doc.
- Soften corner radii beyond `--bf-radius-md` (6px). Sharper is correct here.
- Add hero illustrations, gradients beyond the existing `bf-app` background, or marketing-style iconography.
- Make the inspector a layer-type tab matrix again.

## 4. Production readiness gate

DESIGN.md is acceptable as v1 once §2.1, §2.4, §2.8, §2.11 land. The rest can be added to the `Decision Log` as work surfaces them.

## 5. Implementation status (against the existing repo)

| Area | Spec section | Repo state | Action |
|---|---|---|---|
| `--bf-*` tokens | §3.1 | ✅ in `ui2/src/styles/theme.css` | Keep |
| Legacy `--app-*` alias layer | n/a | ✅ in `theme.css`, all aliases delegate to `--bf-*` | Keep until migration done |
| Tailwind theme consumes tokens | §3 | ⚠️ Tailwind reads `--app-*`, not `--bf-*` directly | Wire Tailwind directly to `--bf-*` semantic colors in addition to the existing aliases |
| `.bf-type-*` classes | §4.2 | ⚠️ partial (`bf-role-*` in `index.css` is the legacy version) | Add `bf-type-*` aliases or migrate roles |
| `.bf-panel` / `.bf-panel-header` | §5.3 | ❌ not present as canonical class | Add minimal classes, do not rewrite components |
| `.bf-button` and variants | §14.1 | ⚠️ existing `Button.tsx` uses shadcn variants; not aligned with `.bf-button` naming | Keep `Button.tsx`, document that `Button` *is* the `bf-button` contract |
| Storybook | n/a | ❌ no Storybook | Defer; recommend via UI contract doc |
| Lint guardrails | n/a | ❌ no design lint | Add `no-restricted-syntax` regex banning raw hex in TSX/TS source (excluding `theme.css`, BIDS color metadata, and SVG icon strings) |
| UI contract doc | n/a | ❌ missing | Author `docs/design-system/ui-contract.md` |
| Decision log | §23 | ❌ missing | Reserve a heading in Design.md |

## 6. Recommendation

Adopt Design.md v1.0 as authoritative. Land the addendum from §2 and the contract doc + lint guardrails from §5 in a single small PR. Do **not** sweep components into new `.bf-*` class names — the existing `ui/Button.tsx`, `ui/PanelHeader.tsx`, `ui/Slider.tsx` already act as `bf-button` / `bf-panel-header` / `bf-slider`; document that mapping and stop.

The instinct to over-build a CSS class layer parallel to the React component layer is the most common failure mode here. Avoid it.
