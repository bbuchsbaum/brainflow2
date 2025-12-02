# UI Redesign Plan (Desert Modern/Bauhaus)

### Goals
- Replace DevTools dark aesthetic with Desert Modern palette and Bauhaus typography.
- Simplify visual hierarchy: floating panels, gaps over borders, geometric controls.
- Align brain-view/plots with new theme without disrupting existing state logic.

### Work Items
- [ ] **Palette & Theme:** Update `ui2/src/styles/theme.css` with Desert Modern HSL tokens and radius; ensure shadcn bridge uses same vars.
- [ ] **Base Styles:** Apply typography + label styles and GoldenLayout overrides in `ui2/src/index.css` (tabs, splitters, headers).
- [ ] **Slider/Control Styling:** Implement `.slider-track/.slider-range/.slider-thumb` overrides in `ui2/src/styles/slider.css` (and any Radix slider wrappers).
- [ ] **Component Tone:** Swap border-heavy wrappers to `bg-card` tonal panels in key UI shells (layer panel, properties drawers, dialogs).
- [ ] **Plot Polish:** Adjust Visx/plot backgrounds, grid lines, bars, and brushes to use new palette tokens.
- [ ] **Light/Dark Toggle Prep:** Confirm `.dark` class wiring; verify both modes render legibly with new tokens.
- [ ] **Regression Pass:** Smoke-test GoldenLayout docking, sliders, and plots for visual regressions and interaction states.

### References
- Source prompt + palette: `redesign_notes.md`
- Current theme/styles: `ui2/src/styles/theme.css`, `ui2/src/index.css`, `ui2/src/styles/slider.css`
