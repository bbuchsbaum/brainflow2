# UI redesign and visual hill climb (2026-10)

## Goal

Make every Brainflow surface coherent, well-crafted and attractive while keeping
the shell: GoldenLayout docking, top bar, Files / Inspector / bottom dock, status
bar. Behaviour, data and scientific rendering are frozen. The September
"Workstation" restyle re-tokened the shell only. Everything inside it is still
a mix of styles.

## Decisions (user, 2026-10-25)

- **Direction:** run a bake-off first. Three token-level directions go on the
  real app harness: refined Workstation plus two bolder alternatives. The user
  picks one, then we hill-climb it.
- **Theme:** dark ships first. Tokens are semantic, so a light theme later is a
  new token file only. Specimens are dark only.
- **Direction chosen (after the bake-off):** hybrid of B "Reading room" and A
  "Workstation". All three critics ranked B > A > C and independently proposed it.
  The rules:
  - Chrome is achromatic, so colour on screen is data or status.
  - A light-neutral primary.
  - A muted amber used only as a focus ring or selection edge.
  - The crosshair is decoupled from the accent: green with a halo.
  - IBM Plex.

  Evidence is in `.hillclimb/redesign/audit/bake-*/RANKING.md` (local), and the
  working rules in `.hillclimb/redesign/HYBRID.md`. The direction-token generator
  (`ui2/scripts/build-direction-tokens.mjs`) is kept as the mechanism for a future
  light theme.
- **Monitoring:** a private claude.ai artifact, updated at the end of each round.
  It shows shots, scores, critiques and decisions. The local harness page and
  evidence remain authoritative.

## Baseline facts (audit, 2026-10-25)

- 252 production `.tsx` files. 404 raw Tailwind palette classes; studio has 201
  of them and uses `bf-*` tokens only twice.
- 92 `uppercase`, 74 `tracking-*`, about 9 effective font sizes between 9 and
  14px. The `text-role-*` utilities are used twice, the `bf-*` spacing tokens
  never.
- Competing implementations:

  | Element | Implementations |
  | --- | --- |
  | Buttons | 278 raw `<button>` with 118 distinct className strings, plus 4 shared buttons. One shared button (`ui/Button`) uses a light-theme palette. |
  | Sliders | 8 |
  | Tabs | 8 |
  | Field rows | 7 |
  | Section / collapsible | 7 |
  | Toolbars | 7 |
  | Menus | 6 |
  | Inputs | none shared; 90 raw `<input>` |
  | Selects | 61 raw `<select>` |
  | Tooltips | 198 native `title=` |

- Hazards to fix before any visible work:
  - **OS-dependent colours:** `darkMode` is unset, so the 38 `dark:` classes
    follow the OS setting. This is a live bug on light-mode Macs.
  - **Global overrides:** `index.css` forces h3/h4 with `!important`, and the
    global `slider.css` thumb styles force specificity hacks.
  - **Plex not applied:** 7 components use `font-sans`, which falls back to the
    system stack instead of Plex.
  - **Dead code:** `modern-ui.css`, `Badge`, `RangeSlider`, `ui/Slider`,
    `ColormapSelector`, `LayerList`/`LayerRow`.
  - **Per-panel React roots:** GoldenLayout creates three separate React roots
    (`GoldenLayoutRoot.tsx:278,315,380`). New providers must be added to all of
    them, or primitives must work without a provider.
- No visual tests exist. Storybook 9 is configured but has only 3 stories.
  `node_modules` is not installed. Playwright 1.48 is pinned, while the cached
  Chromium builds are 1200, 1234 and 1248.

## Refactor architecture (day one)

The approach is strangler-style: new layers sit beside the old ones. Each area
migrates whole, and a lint ratchet stops it from regressing.

1. **Tokens** (`ui2/src/styles/tokens/`)
   - Raw palette → semantic roles: ground, surface, raised, line, text,
     accent, state, data.
   - Plus a type scale (10/11/12/13/15), a spacing scale, control heights
     (20/24/28) and radii.
   - A direction is one file of raw values selected by `data-direction` on
     `<html>`. `--app-*` and the shadcn HSL bridge become derived aliases.
   - The Tailwind config exposes only the semantic names. `darkMode: 'class'`.
2. **Primitives** (`ui2/src/components/ui/bf/`)
   - cva over the Radix packages already installed: Button, IconButton,
     Input/NumberField, Select, Slider (single and range, one engine),
     Switch/SegmentedControl, Tabs (folder and underline variants), Tooltip,
     Menu, Dialog/Sheet, Badge/Chip, Spinner.
   - None needs a React context provider, which avoids the GoldenLayout root
     problem.
3. **Patterns:**
   - Section (absorbs the 7 collapsibles), FieldRow (absorbs 7), PanelHeader,
     Toolbar, ListRow, EmptyState, KeyValue.
   - Each pattern is rendered on a specimen page in the harness.
4. **Surfaces:** migrate one area per hill-climb series. Old components are
   deleted when their last user moves.
5. **Ratchet:**
   - ESLint `no-restricted-syntax` errors on palette classes, `text-[Npx]`,
     `uppercase`, `tracking-[`, and raw `<button>`, `<select>` and `<input>`
     outside `components/ui/bf`.
   - Each rule is enforced per migrated area through an allowlist that only
     shrinks.
   - Harness `toHaveScreenshot` baselines become the regression gate.

## Phases

### Phase 0: foundations (no intended visual change)

1. `pnpm install`. Pin Playwright to a version whose bundled Chromium is already
   cached, or point `executablePath` at the cached headless shell. Record the
   choice.
2. **App harness:** `ui2/app-harness.html` + `src/devHarness/appHarness.tsx`.
   - A deterministic `HarnessTransport`: zero latency, fixed IDs, unknown
     commands logged to `window.__harnessLog`.
   - A `__TAURI_INTERNALS__.invoke` shim for the six services that call
     `invoke` directly.
   - Persisted stores cleared and seeded. RNG and `Date.now` frozen. Animations
     disabled. App imported dynamically after the transport is installed.
3. **Pixels:**
   - Real MNI slices are sampled in JS from a 2 mm uint8 fixture derived from
     `test-data/unit/tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w.nii`. A
     thresholded stats overlay is generated the same way.
   - The surface is fsLR 32k inflated, converted to JSON, and rendered through
     WebGL with SwiftShader.
4. **Scenarios** (`?scenario=`):
   - Workspace: `empty`, `volume`, `volume-surface`, `inspector-layer`,
     `overlay`, `plots`, `mosaic`.
   - Secondary workspaces: `analysis`, `bids`, `studio`.
   - Dialogs: `dialog-goto`, `dialog-header`, `dialog-crosshair`.
   - Readiness is `window.__harnessReady`, set after fonts load and frames
     settle.
5. **Hazard fixes:**
   - `darkMode: 'class'`, strip the `dark:` classes, delete the dead code.
   - Scope `slider.css` and the h3/h4 `!important` rules.
   - Point `fontFamily.sans` at Plex.
6. **Hill-climb harness:** set up in the scratchpad from the
   `visual-hill-climb` skill. Write `RUBRIC.md` and `FROZEN.md`, capture v0 for
   all scenarios at 1600×1000 @1x plus 1280×800, and record the critics' v0
   scores.

Check: `pnpm --filter temp-ui exec tsc -b`, `vitest run`, `lint`, `build`; the
harness boots every scenario with no unknown commands; v0 shots are byte-stable
across two captures.

### Phase 1: direction bake-off

- Tokens v2 (semantic layer), then three direction files:
  - A: refined Workstation.
  - B and C: bolder alternatives, written down before rendering.
- Every scenario is captured under each direction. Critics score them, and the
  artifact shows them side by side. **The user picks.** The bake-off changes
  tokens only, so the losing directions cost nothing to discard.

### Phase 2: primitives

- Build the 12 primitives with a `primitives` harness specimen (all states:
  default, hover, focus, active, disabled, error).
- Hill-climb the gallery: baseline plus up to three rounds.

### Phase 3: patterns

Section, FieldRow, PanelHeader, Toolbar, ListRow, EmptyState and KeyValue get a
specimen page and a hill climb.

### Phase 4: surface migration

Each surface is its own hill-climb series, with baseline plus up to three
rounds:

1. Shell polish, including the deferred per-viewport header strip
   (plane + slice coordinate). It needs the `SliceViewport` placement
   contract reviewed.
2. Inspector and layer controls (about 6k LOC, always visible).
3. Dialogs.
4. Analysis workbench and BIDS.
5. Plot chrome (marks keep `--bf-plot-*`).
6. Studio (9.2k LOC, dirtiest).
7. Files panel (already coherent CSS).

### Phase 5: ratchet and lock-in

- Lint errors are enforced in every area.
- Harness screenshot baselines are committed as a Playwright project.
- AGENTS.md visual-style contract updated.
- Storybook stories for every primitive and pattern.

## Hill-climb protocol

- **Rubric dimensions** (fixed per series):
  - hierarchy, typography, color, layout/density, component consistency,
    function/accessibility, identity, scientific fidelity.
  - Fidelity and accessibility defects block acceptance; they cannot be
    averaged away.
- **Critics** (fresh context; they see shots and the rubric, never the
  builder's reasoning):
  - visual designer (the `impeccable` critique lens)
  - function/accessibility
  - target user (a cognitive neuroscientist doing a daily analysis session)
  - an optional cross-model critic through the Codex council
- **Stopping rule:** stop at the budget, or after two successive rounds that
  move each critic by less than 0.2 with no unresolved regressions. The best
  qualifying round wins, not the latest.
- **Frozen** (`FROZEN.md`):
  - colormaps, crosshair geometry, orientation and labels, slice placement and
    square pixels
  - command and store contracts
  - copy that tests assert on, unless the change is deliberate and the test is
    updated in the same commit
- **Evidence:**
  - Local evidence stays under the harness: `out/`, `shots/`, `critiques/`,
    `logs/`.
  - Each round updates the artifact with shots, scores and a change summary.
- **Git:** a branch per phase, a commit per accepted round, and a fresh-context
  code review before each merge.

## Risks

- **Mock replies for the loaded state:** reaching the loaded state through the
  real load → layer → GPU → render orchestration needs correctly shaped mock
  replies. A wrong payload leaves views silently blank. Fallback: seed the
  stores. That risks drift from the real UI, so log it.
- **Surface rendering:** WebGL determinism under SwiftShader. Pin one browser
  binary.
- **Harness fidelity:** the harness is not the native app. Each phase ends with
  one native `.app` check through computer use (see the memory note on
  verifying the dev app through the `.app` bundle).
