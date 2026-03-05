# UI Token Audit (Phase 1)

Date: 2026-03-04
Scope: `FileBrowserPanel` and right-sidebar adjacent panels (`VolumeLayerPanel`, `PlotPanel`, `LayerPropertiesManager`)

## Summary

This audit captures repeated hardcoded visual values and maps them to semantic design tokens used during the UI clarity refactor.

## Repeated Values Found

| Existing value pattern | Where it appeared | Token mapping |
|---|---|---|
| `text-[9px]`, `text-[10px]`, `text-[11px]`, `text-[13px]` | Files/Plots/Layer Properties headings and microcopy | `--app-role-section-size`, `--app-role-label-size`, `--app-role-body-size`, `--app-role-title-size` |
| Mixed uppercase tracking (`tracking-[0.15em]`, `tracking-[0.2em]`) | Panel headers and labels | `--app-role-title-tracking`, `--app-role-section-tracking` |
| Small interactive controls (`20px`, `24px`) | Sort buttons, header icon buttons | `--app-control-height-xs`, `--app-control-height-sm` |
| Inline border radius (`1px`, `2px`) | Panel cards, badges, small controls | `--app-radius-sm`, `--app-radius-md` |
| Ad-hoc focus affordances (`box-shadow` only) | Search/select controls | `--app-focus-ring-color`, `--app-focus-ring-width`, `--app-focus-ring-offset` |
| Hardcoded spacing (`4px`, `8px`, `12px`, `16px`, `24px`) | Forms, cards, status bars | `--app-spacing-xs`, `--app-spacing-sm`, `--app-spacing-md`, `--app-spacing-lg`, `--app-spacing-xl` |

## Token Additions (Phase 1)

Added semantic role and interaction tokens in `ui2/src/styles/theme.css`:

- Typography roles:
  - `--app-role-title-*`
  - `--app-role-section-*`
  - `--app-role-label-*`
  - `--app-role-body-*`
  - `--app-role-value-*`
- Control sizing:
  - `--app-control-height-xs`
  - `--app-control-height-sm`
  - `--app-control-height-md`
- Focus ring:
  - `--app-focus-ring-color`
  - `--app-focus-ring-width`
  - `--app-focus-ring-offset`

Tailwind mappings added in `ui2/tailwind.config.js`:

- Semantic `fontSize` aliases: `text-role-title`, `text-role-section`, `text-role-label`, `text-role-body`, `text-role-value`
- Semantic spacing/size aliases: `h-control-sm`, `min-h-control-md`, etc.
- Semantic letter spacing aliases for section/title roles

Global typography utility classes added in `ui2/src/index.css`:

- `.bf-role-title`
- `.bf-role-section`
- `.bf-role-label`
- `.bf-role-body`
- `.bf-role-value`
- `.bf-role-mono`

## Migration Checklist

- [x] Define semantic typography tokens.
- [x] Define control sizing and focus ring tokens.
- [x] Apply tokens to Files panel empty state and control strip.
- [x] Apply role utilities to right-sidebar `VolumePanel` labels/headings.
- [x] Migrate shared panel primitives (`CollapsibleSection`, `PropertyRow`) to role utilities.
- [x] Apply role tokens to `PlotPanel`.
- [ ] Replace remaining hardcoded icon/button dimensions in right sidebar panels.
- [x] Normalize `focus-visible` rings on touched controls (Files action buttons, section toggles, Plot refresh, Volume toggles).
- [x] Raise dense touched controls to tokenized minimum hit targets (~32px+) in Files/Plot/Volume components.
