# Brainflow UI Contract

This document is the **enforcement layer** for the design direction in [`resdesign/Design.md`](../../resdesign/Design.md).

`Design.md` is the *intent* — the language, doctrine, and visual system. This contract is the *rules a developer or reviewer can check against during a PR*.

If `Design.md` and this contract disagree, `Design.md` wins. Update this file in the same PR.

---

## 1. Source of truth map

| Decision | Lives in | Read order |
|---|---|---|
| Visual doctrine, principles, layout, mockup-7 direction | `resdesign/Design.md` | First |
| Token values (`--bf-*`) and legacy `--app-*` aliases | `ui2/src/styles/theme.css` | Second |
| Tailwind exposure of tokens (semantic colors, spacing, radii, fonts) | `ui2/tailwind.config.js` | Third |
| Reusable components ("the `bf-*` contract") | `ui2/src/components/ui/*` | Fourth |
| Composition primitives (panels, dock, viewport) | `ui2/src/components/layout/*`, `ui2/src/components/views/SliceViewport.tsx` | Fourth |
| Per-screen layout glue | feature folders under `ui2/src/components/{panels,studio,analysis,...}` | Last |
| Decision log (date-stamped amendments) | this file, §10 below | Always |

A change at a higher row should be preferred over a change at a lower row. Do not solve a repeated screen-level inconsistency by editing screens — fix it at the higher row and let it propagate.

## 2. Token rules

1. Components read **semantic** tokens, never raw hex or one-off pixel values.
2. New tokens go into `theme.css` first, expressed as `--bf-*`. Aliases under `--app-*` are added only if a legacy consumer still needs them.
3. The shadcn HSL block (`--background`, `--foreground`, etc.) is a *projection* of `--bf-*`. Never set those directly to a hex; always derive from the canonical `--bf-*` value.
4. Anatomical orientation tokens (`--bf-axial`, `--bf-sagittal`, `--bf-coronal`, `--bf-crosshair`) are reserved. Never rebind them to non-anatomical roles.
5. Typography is consumed through Tailwind classes (`text-role-*`, `font-mono`) or the `bf-role-*` utility classes — not by hand-rolling `font-size` / `letter-spacing`.

### Allowed exceptions
- BIDS / file-type / atlas-label *data* colors (e.g. `fileBrowserStore.ts`, `surfaceLayers.ts`, `filesystem.ts`) are domain data, not UI styling. They live as TS constants and are exempt.
- SVG icon `stroke="..."` literals embedded in `data:image/svg+xml` strings are exempt; lift to a CSS variable when the same icon is used in multiple states.
- WGSL/Rust shader code is exempt.

## 3. Component rules

1. The reusable component layer is **`ui2/src/components/ui/*.tsx`**. Treat each export there as the canonical `bf-*` component. Map:

   | `Design.md` name | Repo component |
   |---|---|
   | `bf-button` | `Button.tsx` |
   | `bf-input`, `bf-select` | `*` (use Radix primitives wrapped where needed) |
   | `bf-toggle` | `Switch` (Radix) usage in `*Inspector` panels |
   | `bf-slider` | `Slider.tsx`, `SingleSlider.tsx`, `RangeSlider.tsx` |
   | `bf-panel`, `bf-panel-header` | `PanelHeader.tsx` + GoldenLayout panel chrome |
   | `bf-display-mode` | `DisplayModeSelector.tsx` |
   | `bf-time-row` | `TimeSlider.tsx` + center workspace time row |
   | `bf-statusbar` | `StatusBar.tsx` |
   | `bf-tool-rail` | Surface viewport tool rail |
   | `bf-active-layer-banner` | Right inspector header in `Inspector/*` |
   | `bf-layer-row` | `LayerRow.tsx` |
   | `bf-tree-row` | BIDS tree rows under `components/bids/*` |

2. Any *new* visual variant adds: a prop on the existing component, a story or example, and a usage rule below in §6. **Never copy markup into a screen and tweak it.**

3. Repeated row/list/card structures must become composition primitives, not duplicated JSX.

4. Inline `style={{ ... }}` is allowed only for genuinely dynamic runtime values: GoldenLayout-driven sizing, drag transforms, GPU-readback canvas dimensions, dynamic color from data. Static color/spacing/radius must come from a token.

## 4. Naming rules

- React component file names use `PascalCase.tsx`, exported under the same name.
- CSS classes use `kebab-case`, prefixed:
  - `bf-*` for canonical chrome and layout primitives (Design.md).
  - `bf-role-*` for typography roles (legacy, equivalent to `bf-type-*` in Design.md §4.2).
  - `bf-thumb-circle` and similar for native-element overrides that can't be expressed in Tailwind.
- Tailwind utility classes are the default styling vocabulary. Custom CSS classes are added only when:
  - Tailwind cannot express it (e.g. `::-webkit-slider-thumb`, gradient backgrounds with custom stops).
  - The same combination repeats in 4+ places — at that point it's a primitive, not a utility.

## 5. Layout rules (Design.md §2)

- Top bar 40px, status bar 44px, time row 48px, panel header 34px. These are tokens (`--bf-topbar-h`, `--bf-statusbar-h`, `--bf-time-row-h`, `--bf-panel-header-h`); use them, not magic numbers.
- Three-column shell: left rail 320 (min 280, max 420), inspector 376 (min 340, max 460), bottom dock 220 (min 160, max 340). Express these via the `layout` constants in `Design.md` §2.2 when wired into Allotment / GoldenLayout.
- Panel gap is 6px. Panel radius is `--bf-radius-md` (6px). Both apply to every dockable panel.
- One canonical time row per workspace, in the center. The inspector may show advanced timing metadata only; never a second scrubber.

## 6. Variant policy

When a screen needs a visual variant of an existing component:

1. Check if the variant already exists.
2. If not, add a prop to the component (`variant`, `size`, `tone`, etc.). Variants must be enumerated, not free-form strings.
3. Document the variant in this file (or, when Storybook arrives, in a story).
4. Apply it from the screen — do not override styles via `className` to mimic a variant.

Forbidden patterns (lint targets, see §8):
- A screen that imports `Button` then overrides `bg-*` / `border-*` / `text-*` via className to fake a new variant.
- Two screens implementing the same row/card markup with different paddings.
- A new color introduced as a Tailwind arbitrary value (`bg-[#1a2b3c]`).

## 7. Storybook

Storybook 9 is configured under `ui2/.storybook/`. Run:

```bash
pnpm --filter temp-ui storybook        # dev server on :6006
pnpm --filter temp-ui build-storybook  # static build into ui2/storybook-static/
```

Story locations:
- `src/**/*.stories.{ts,tsx,mdx}` — co-located with components.
- `src/**/__stories__/**.{ts,tsx,mdx}` — design-system reference stories that aren't tied to a single component (e.g. `Tokens.stories.tsx`).

The seed coverage:
- `Button.stories.tsx` — variants, sizes, disabled, loading, all-variants composition.
- `PanelHeader.stories.tsx` — title-only, with-icon, with-primary-action, with-overflow.
- `__stories__/Tokens.stories.tsx` — visual reference for `--bf-*` color tokens, typography, radii, and spacing. Designers and contributors should land here first.

Story rules:
- Every component under `components/ui/*` should have a story showing default, all variants, all sizes, disabled, loading where applicable, and a realistic composition example.
- Stories must NOT mock Zustand stores in-line. If a component is too tightly coupled to stores to render in isolation, extract a presentational prop-driven inner component first, story that, and let the outer wrapper stay untested by Storybook.
- Stories use the canonical theme: `preview.ts` imports `src/index.css` so every story renders against the real `--bf-*` tokens.

## 8. Lint guardrails

The repo enforces (warn-level) the following via ESLint:

- `no-restricted-syntax` ban on raw 6/8-digit hex literals in `*.tsx` files outside `src/styles/**`, `src/types/**` (BIDS data), and `src/stores/fileBrowserStore.ts`.
- Future targets (not yet active, listed for the decision log):
  - Static-value `style={{}}` warnings.
  - Tailwind arbitrary-value (`bg-[...]`) warnings outside an allowlist.

Lint runs as part of `pnpm lint` (project root) and `pnpm --filter ui2 lint`.

## 9. Review checklist

A PR that touches UI must answer "yes" to each:

- [ ] Did I read `Design.md` for the surface I'm touching?
- [ ] Did I use semantic tokens, not raw hex / pixel literals?
- [ ] Did I extend an existing component instead of copying markup?
- [ ] If I added a token, did it go into `theme.css` first?
- [ ] If I changed token values, did I check the consequence on all aliased `--app-*` consumers?
- [ ] If I added a new variant, did I record it in §6 or a story?
- [ ] Does the change survive at 1280×800 and at 2× scale?
- [ ] Does every interactive element have a visible focus state?
- [ ] Did I avoid putting an editable control in two places (Design.md §1.4)?
- [ ] If I changed cross-panel state semantics, is it in a Zustand store, not React Context?

## 10. Decision log

Append entries here. Newest first. Format: `YYYY-MM-DD — area — decision — rationale`.

- **2026-05-02 — contract** — Established this contract document; mapped existing `ui/*.tsx` components to Design.md `bf-*` names rather than minting parallel CSS classes. Rationale: avoiding a third style layer and accepting that Button.tsx is the canonical `bf-button` is cheaper than rewriting components into class-based markup.
- **2026-05-02 — tokens** — Wired Tailwind theme to consume `--bf-*` semantic colors directly (in addition to the existing `--app-*` alias path). Rationale: lets new code use `bg-bf-bg-panel` / `text-bf-text-secondary` without going through legacy alias names.
- **2026-05-02 — lint** — Enabled warn-level ban on raw hex in `*.tsx` outside the data/type allowlist. Rationale: catch the most common drift before it spreads; keep at warn-level until the existing 220-instance backlog is triaged.

