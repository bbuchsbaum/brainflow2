# Workstation shell restyle for `ui2`

## Context

The current Brainflow chrome reads as a generic SaaS dashboard: navy-tinted grounds, a filled Tailwind-blue primary button and blue tab underlines, tracked-uppercase labels everywhere (VOLUME BUFFER EMPTY, tab names, section kickers), cube/hexagon empty-state glyphs with "awaiting input stream" copy, circular V/S badges in the scene list, Inter. The user picked the **Workstation** direction from the design canvas (https://claude.ai/code/artifact/03fe4213-ecb9-4df6-adeb-8c8dd946e636, page "Workstation"; working files in `docs/design/brainflow-directions/Main.dc.html` and `EmptyState.dc.html`): warm neutral grays, IBM Plex Sans + Plex Mono, sentence case, 2px radii, 28px controls, one amber accent (`#e0a63f`) shared by active states and the crosshair, flush "folder" tabs instead of underlines, an inverted primary button, text-only empty states.

This phase carries that direction into the app shell that appears in the two screenshots: tokens, GoldenLayout tab strips, top bar, Files start panel, viewport/surface empty states, slice slider and orientation letters, Inspector scene list, bottom dock tabs, status bar, toast, crosshair default. Layout, panel split and behaviour are unchanged. No Rust changes.

**Explicitly out of this phase** (stated so nobody expects them):
- The 22px per-viewport header strip ("Axial · z = 18.0 mm") shown in the mock. It changes the slice viewport's placement contract (`SliceViewport.tsx`, `SLIDER_HEIGHT`, label offsets, click-to-world mapping) and deserves its own phase.
- The full tracked-uppercase sweep beyond the shell. 69 files use `uppercase`/`tracking-*`; the analysis workbench, BIDS explorer, studio, plots and layer panels keep their literal `uppercase` classes for a follow-up sweep. The shared role tokens are neutralised here so those screens already lose their tracking.
- Switching Tailwind to `darkMode: 'class'` (noted by the token audit; the sky/emerald `dark:` badge classes are removed here anyway).

## Design decisions (from the approved mock)

| Token / element | Now | Target |
|---|---|---|
| Grounds `--bf-bg-app / shell / panel / raised / sunken / canvas / input / hover / active / selected` | `#05080c #07101a #0b1521 #101c2a #050b12 #020508 #08111c #122235 #16345d #123a72` | `#161615 #1e1e1d #1e1e1d #282827 #111110 #080808 #161615 #2a2a29 #333331 #3a3529` |
| Borders subtle / default / strong / focus / divider | slate rgba 0.14/0.24/0.38, `#3b82f6`, 0.16 | `rgba(255,255,255,0.09)` / `0.18` / `0.28` / `#e0a63f` / `0.09` |
| Text primary / secondary / muted / faint / inverse | `#e6edf7 #b7c4d4 #7f8fa3 #566579 #020617` | `#ebe8e2 #b3afa7 #7d796f #55524c #161615` |
| Accent / hover / active / soft; brand | `#2f80ff #4c93ff #1f6feb`, `#7c3aed` | `#e0a63f #eab65a #cf9630 rgba(224,166,63,0.16)`; brand = accent |
| `--app-accent-foreground` | `#ffffff` | `#161615` |
| Radii xs/sm/md/lg | 3/4/6/8 | 2/2/3/4 (pill unchanged); shadcn `--radius` 6px → 4px |
| Fonts | Inter (Google import), SF Mono / JetBrains Mono (two stacks) | IBM Plex Sans / IBM Plex Mono, self-hosted via `@fontsource`, one mono stack |
| Role tokens | section 11px/600/0.12em uppercase, title tracking 0.08em | section 11px/500/0, title tracking 0.01em; `.bf-role-section` no `text-transform` |
| Top stripe `body { border-top: 2px accent }` | on | `--top-accent-height: 0px` |
| Slider thumb `.bf-thumb-circle` | 10px sky circle | 6×12px amber rectangle, radius 1px, `margin-top: -4.5px` |
| Crosshair default (`crosshairSettingsStore`) | `#e07830` "Orange (Default)" | `#e0a63f` "Amber (Default)"; keep Orange as second preset |
| Wordmark | 20px blue→violet gradient square, "BrainFlow" 14/700 | 16px stroked slice glyph in accent, "Brainflow" 13/600 (matches the window title) |

shadcn HSL bridge (`theme.css` `--background` … `--ring`) is remapped to the same palette: background `60 2% 8%`, card/popover `60 2% 12%`, foreground `40 18% 90%`, primary `38 72% 56%` with primary-foreground `60 2% 8%`, secondary/muted `60 1% 16%`, muted-foreground `43 6% 46%`, accent (Tailwind's *hover* semantic, not the amber) `60 1% 16%` with accent-foreground = foreground, border `60 2% 22%`, input = background, ring = primary. Consumers of `hover:bg-accent/30` become invisible at 16% lightness, so the few rows that use it switch to `hover:bg-accent`.

## Tasks (each ends with its check; stop and report if a check fails)

**0. Record the plan.** Copy this file to `docs/plans/workstation-shell-restyle.md` (CLAUDE.md asks for phase plans in the repo).

**1. Fonts and tokens.**
- `pnpm --filter ui2 add @fontsource/ibm-plex-sans @fontsource/ibm-plex-mono`; in `ui2/src/main.tsx` import `@fontsource/ibm-plex-sans/{400,500,600}.css` and `@fontsource/ibm-plex-mono/{400,500}.css` before `./index.css`; delete the Google `@import` at `ui2/src/index.css:1`.
- `ui2/src/styles/theme.css`: rewrite the `:root` block values per the table (lines 37–131), the HSL bridge (138–157), `--app-accent-foreground` (≈L188), `--top-accent-height` (≈L282), scrollbar thumbs → `rgba(255,255,255,0.14/0.26)`, role tokens (219–237), `.bf-thumb-circle` (335–357). Keep every token *name*; only values change, so the `--app-*` aliases and all consumers follow.
- `ui2/src/index.css:72-78` `.bf-role-section`: drop `text-transform: uppercase`.
- `ui2/tailwind.config.js:167-169` `fontFamily.mono` → `['IBM Plex Mono', 'SFMono-Regular', 'Menlo', 'monospace']`.
- `ui2/src/styles/slider.css` generic range thumb → same amber rectangle.
- Check: `pnpm --filter ui2 exec tsc -b` (baseline is 0 errors), `pnpm --filter ui2 test` (baseline: run once before editing and record failures).

**2. GoldenLayout tab strips** (`ui2/src/index.css:164-215, 275-353, 355-408`).
- `.lm_header`: `background: var(--bf-bg-app)`, replace the 2px border with `box-shadow: inset 0 -1px 0 var(--bf-border-subtle)`, height 32.
- `.lm_tab`: `font-family: var(--bf-font-sans)`, 12px/500, no uppercase/letter-spacing, `opacity: 1`, `color: var(--bf-text-muted)`, `margin: 0`, `padding: 0 22px 0 14px`, height 32. Hover: `color: var(--bf-text-primary)`. Active: text primary, `background: var(--bf-bg-panel)`, `box-shadow: inset 1px 0 var(--bf-border-subtle), inset -1px 0 var(--bf-border-subtle)`. Remove `.lm_tab.lm_active::after`.
- `.lm_content` → `var(--bf-bg-panel)`; splitter track → `var(--bf-bg-app)`, hairline `var(--bf-border-subtle)`, hover grip `hsl(var(--primary))` (it currently reads `hsl(var(--accent))`, which becomes the neutral hover gray).
- Header/tab-close data-URI icons: `%235C6370` → `%237d796f`, hover `%23E07830` → `%23e0a63f`.
- Check: `pnpm --filter ui2 test` (GoldenLayoutRoot tests), visual in task 11.

**3. Top bar** (`ui2/src/components/ui/TopAppBar.tsx:60-80`, `DisplayModeSelector.tsx:117-157`, `StatusBar.css .status-toggle`).
- Wordmark: replace the gradient `<span>` with an inline 16px SVG (rect 12×12 rx1 + horizontal mid-line + faint vertical) stroked `var(--bf-accent)`; text "Brainflow", 13px/600, `letter-spacing: 0.01em`. Update `TopAppBar.test.tsx:35` regex to `/Brainflow/i`.
- Selector: drop `className="bf-role-section"`, `letterSpacing`, `textTransform`; `fontSize: 12px`; active `background: var(--app-text-primary)`, `color: var(--bf-text-inverse)`, weight 600; inactive weight 500 `var(--app-text-secondary)`.
- `.status-toggle`: `height: 24px`, `background: var(--bf-bg-panel-raised)`, `font-size: 11.5px`.

**4. Files start panel** (`ui2/src/components/panels/files/FilesStartPanel.tsx`, `FilesStartPanel.css`, `DropTargetFooter.tsx:9`).
- Strings: "Mount directory", "Mount remote (SSH)…", "Open file…", "Drop a NIfTI or GIfTI file to load". (`CommandPaletteDialog.test.tsx:17,35` uses its own fixture title, unaffected.)
- CSS: `.files-start-kicker` no uppercase/tracking, 12px/600 secondary; `.files-start-command` `min-height: 28px`, `background: var(--bf-bg-panel-raised)`, border `var(--bf-border)`, radius 2px; `--primary` → `background: var(--bf-text-primary); color: var(--bf-text-inverse); border-color: transparent`, hover `#f5f2ec`; `.files-start-section-title` → mono 11px muted, no uppercase; `.files-start-drop` radius 2px, border `var(--bf-border)`.

**5. Viewports** (`RenderOverlays.tsx:106-142`, `SurfaceViewPanel.tsx:258-350`, `SliceViewCanvas.tsx:570-613`, `SliceSlider.tsx:119-148`, `SurfaceAssociationBadge.tsx:34-51`).
- `NoLayersOverlay`: delete the cube SVG; "No volume loaded" as `text-[12px] font-medium` with `color: var(--bf-text-secondary)`; hint `font-mono text-[11px] text-muted-foreground` "Double-click a file in Files, or drop one here" (one line, no uppercase). Update `SliceView.test.tsx:106` to `'No volume loaded'`.
- Surface empty state: delete the hexagon SVG; title 12px/500 secondary; button `rounded-sm border border-border bg-card h-7 px-2.5 text-[12px]`.
- Surface info card: title `text-[10.5px] font-mono text-foreground` (no uppercase/tracking), `border-radius: 2px`, bg `hsl(var(--card)/0.92)`.
- Orientation letters: `font-mono text-[10.5px] text-white/50` (drop `font-bold tracking-[0.15em]`).
- Slider strip: `bg-card` with the 1px top hairline, track `h-px bg-border`; thumb comes from task 1.
- `SurfaceAssociationBadge` `CARD_BASE_STYLE`: remove `letterSpacing`/`textTransform`, `fontSize: 11px`, `fontWeight: 500`, `borderRadius: 2px`.

**6. Inspector** (`InspectorRouter.tsx:80-104,158-166`, `imaging/InspectorSection.tsx:41-52`, `imaging/SceneStack.tsx:73-81,111,173-178`, `imaging/SceneStackItem.tsx`).
- Toolbar buttons: `rounded-sm border border-border bg-card h-6 px-2 text-[11.5px]`; Annotate active → `border-primary/50 bg-primary/15 text-primary` (drop sky classes).
- Section label: `text-[12px] font-semibold` (drop uppercase/tracking); meta `font-mono text-[11px] text-muted-foreground`.
- Group labels: `font-mono text-[11px] text-muted-foreground` (no uppercase), strings "Volume view" / "Surface view" / "Mappings"; empty hints "No volumes loaded · use Load", "No surfaces loaded"; placeholder `rounded-sm border border-dashed border-border h-[30px] px-2 text-[11.5px]`. Update `ImagingInspector.test.tsx:112-113`.
- `SceneStackItem`: replace the 24px letter badge with a 14px stroked inline SVG per kind (volume kinds → three stacked layers; surface kinds → triangle mesh; mapping → arrow), all `text-secondary`-coloured via `style={{ color: 'var(--bf-text-secondary)' }}`; drop `COLOR_TEXT/BG/BORDER`; row `rounded-sm gap-2.5 px-2 h-[34px] hover:bg-accent`; selected `bg-card shadow-[inset_2px_0_0_hsl(var(--primary))]`, title `text-foreground` in both states, weight 400.
- Footer: add `font-mono`.

**7. Bottom dock** (`BottomWorkbenchDock.tsx:116-160`). Bar `background: var(--app-bg-tertiary)`. Tab: drop `bf-role-section`, `letterSpacing`, `textTransform`, the 1px border and 22px chip; `height: 34px`, `padding: 0 10px`, `fontSize: 12px`, `fontWeight: 500`, `borderRadius: 0`; active `background: var(--app-bg-primary)`, `boxShadow: inset 1px 0 var(--app-border-subtle), inset -1px 0 var(--app-border-subtle)`, text primary; inactive transparent, muted. Tests only check labels and ids.

**8. Status bar** (`StatusBar.tsx:49-58`, `StatusBar.css`). Labels without the colon and in sentence case ("Coordinate system", "Crosshair", "Mouse", "Layer", "Region", "Atlas", "FPS", "GPU"); `.status-bar` `height: 28px`, `background: var(--app-bg-tertiary)`, `border-top: 1px solid var(--app-border-subtle)`; `.status-label` no uppercase/letter-spacing, 11px; `.status-value` 11.5px mono. Crosshair value turns amber through the accent token. (`coordinate-integration.test.tsx` only uses the phrase in a describe title.)

**9. Toast** (`NotificationToast.tsx:86-104`). Message `text-[12px]` (drop `font-mono uppercase tracking-wider`); card `border-radius: 2px`, `background: var(--bf-bg-panel-raised)`, border `var(--bf-border)`; indicator colours already follow tokens.

**10. Crosshair default** (`stores/crosshairSettingsStore.ts:12-21,66`; `theme.css --bf-crosshair`). `DEFAULT_SETTINGS.activeColor = '#e0a63f'`; presets `[{ 'Amber (Default)', '#e0a63f' }, { 'Orange', '#e07830' }, …]`; `--bf-crosshair: #e0a63f`. Grep tests for `#e07830` (none found) and re-run `crosshair*` tests.

**11. Verification pass.**
- `pnpm --filter ui2 test`, `pnpm --filter ui2 exec tsc -b`, `pnpm lint` (ui2 scope), `pnpm --filter ui2 build`.
- Visual: build the debug bundle per the memory note (`cargo tauri build --debug --bundles app -c '{"build":{"beforeBuildCommand":"cd ui2 && npx vite build"}}'`, `lsregister -f target/debug/bundle/macos/Brainflow.app`, `open`), then with the computer-use MCP screenshot (a) the fresh window (nothing loaded) and (b) after loading the MNI152 template and fsaverage5 pial surface from the app menus, matching the two original screenshots. Compare against the mock frames; fix drift (spacing, contrast, clipped labels).
- Independent review: a fresh-context subagent reads the diff against the mock and the token table and reports regressions before commit.

**12. Docs.** Add a short "Visual language (2026-09-05)" paragraph to `AGENTS.md` Integration Notes: tokens live in `ui2/src/styles/theme.css` (`--bf-*`, aliases `--app-*`, shadcn HSL bridge), Plex Sans/Mono self-hosted via fontsource, sentence-case labels (no tracked uppercase in the shell), one amber accent, flush GoldenLayout tabs; note the two deferred items above.

## Files touched

`ui2/package.json`, `ui2/src/main.tsx`, `ui2/src/index.css`, `ui2/src/styles/theme.css`, `ui2/src/styles/slider.css`, `ui2/tailwind.config.js`, `ui2/src/components/ui/{TopAppBar,DisplayModeSelector,RenderOverlays,SliceSlider,NotificationToast,StatusBar}.tsx`, `ui2/src/components/ui/StatusBar.css`, `ui2/src/components/panels/files/{FilesStartPanel.tsx,FilesStartPanel.css,DropTargetFooter.tsx}`, `ui2/src/components/views/{SurfaceViewPanel,SliceViewCanvas,SurfaceAssociationBadge}.tsx`, `ui2/src/components/inspector/InspectorRouter.tsx`, `ui2/src/components/inspector/imaging/{InspectorSection,SceneStack,SceneStackItem}.tsx`, `ui2/src/components/layout/BottomWorkbenchDock.tsx`, `ui2/src/stores/crosshairSettingsStore.ts`, four test files (`TopAppBar`, `SliceView`, `ImagingInspector`, plus any crosshair colour test), `AGENTS.md`, `docs/plans/workstation-shell-restyle.md`.
