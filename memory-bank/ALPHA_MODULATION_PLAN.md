# Intensity-Modulated Overlay Alpha ("Transparent Thresholding")

Status: IMPLEMENTED — ship-approved by fresh-context review 2026-06-20 (mote umbrella `alpha-modulation`)
Owner: rendering + UI
Last updated: 2026-06-20

## Implementation status (2026-06-20)
Shipped across P1 (core render), P2 (plumbing), P3 (Inspector UI). Default-off everywhere ⇒
byte-identical to prior rendering until opted in per layer. Verified: WGSL naga validation +
std140 offset/field-order/size(176) tests; render_loop lib (30) + ubo (8) + threshold/blend tests;
`cargo xtask ts-bindings` (AlphaModConfig/AlphaModMode/LayerConfig.alpha_mod); adapter
string→enum test (`alpha_mod_frontend_maps_to_backend_layer_config`); UI control test (4) +
existing inspector test (8); tsc + eslint clean on changed files. Fresh-context code review:
**SHIP**, no blockers/should-fix.

Known limitation (documented, accepted for v1): the alpha ramp floor uses `clamp(thresh_low,0,hi)`
for all threshold modes. Under "Below" threshold mode (gate uses `thresh_high`), the ramp floor may
not align with the active gate boundary. Faithful to the contract above and self-consistent with the
sparkline; revisit only if alpha-mod is exercised with Below-mode thresholds.

## Motivation

Statistical/contrast overlays currently use a **hard threshold gate** (voxel shown
or not) plus a **single global opacity**. This manufactures a false sharp boundary
at the threshold and hides the magnitude structure just above it.

The neuroimaging best-practice ("transparent thresholding", FSLeyes *modulate
alpha*, AFNI alpha-thresholding, pycortex) is to make **opacity a monotonic
function of overlay magnitude**: weak supra-threshold voxels fade into the
anatomy, strong voxels are opaque. Color still encodes value via the colormap;
opacity *also* encodes value. The result is both prettier and more honest.

## Model

Per overlay voxel, with `raw_value` the sampled intensity:

```
mag   = |raw_value - center|                                  # two-sided about center (default 0)
hi    = max(|intensity_max - center|, |intensity_min - center|)   # top of magnitude window
lo    = clamp(thresh_low, 0, hi)                               # ramp floor = threshold magnitude
t     = clamp((mag - lo) / max(hi - lo, eps), 0, 1)           # normalized position in window
shape = (mode == gamma) ? pow(t, gamma) : t                   # linear or gamma-shaped
alpha = layer_opacity * gate(raw_value) * shape               # gate = existing threshold
```

- `mode == off` ⇒ `shape` skipped, `alpha = layer_opacity * gate(...)` → **byte-identical to today**.
- Because `lo`/`hi` read live from threshold + intensity window, the ramp
  **auto-rescales** when either slider moves ("adapts to range and thresholds").
- The linear/gamma ramp starts at 0 at `mag == lo`, so it **inherently softens the
  threshold edge** (voxels at threshold are transparent and fade in) — this is the
  transparent-thresholding benefit, no separate soft-edge knob needed in v1.
- `gamma < 1` reveals weak voxels sooner; `gamma > 1` suppresses them; `gamma == 1` = linear.

### Scope decisions (locked)
- v1 control surface: **mode toggle (Off / Linear / Gamma) + one γ slider + live curve sparkline.** Minimal, extensible.
- Magnitude: **two-sided about `center`** (correct for signed/diverging maps such as `era_diag_minus_off`). `center` defaults to 0; one-sided positive maps are the special case where everything is ≥ center.
- 4th UBO field reserved (`_pad_alpha`) for a future explicit soft-knee / alpha-floor without another layout migration.

### Caveats (documented, handled in UI)
- The composite fn only uses `src.a` for color under **Normal** and **Additive** blend modes; **Max/Min** ignore alpha for RGB, so modulation is a visual no-op there → UI disables the Alpha subsection (with tooltip) when blend mode is Max/Min.
- Ramp `lo` uses `clamp(thresh_low, 0, hi)`: for Absolute/Above modes this is the magnitude floor; for Range/Below modes `thresh_low` may be negative and clamps to 0 (ramp spans the full window) — acceptable, documented v1 behavior.

## Implementation map (file:line verified 2026-06-20)

### Phase 1 — Core render path (no behavior change; default Off)
1. `core/render_loop/src/ubo.rs`
   - Grow `LayerUboStd140` (currently 160 B, pinned by `const _: [(); 160]` at L206) by one 16-byte block → 176 B:
     `alpha_mod_mode: u32`, `alpha_gamma: f32`, `alpha_center: f32`, `_pad_alpha: f32` (offsets 160/164/168/172).
   - Update the const size assertion 160 → 176 and `Default` (mode 0, gamma 1.0, center 0.0, pad 0.0).
2. `core/render_loop/src/render_state.rs:291` — add to `LayerInfo`: `alpha_mod_mode: u32` (0 off/1 linear/2 gamma), `alpha_gamma: f32`, `alpha_center: f32`; defaults 0 / 1.0 / 0.0 at L318.
3. `core/render_loop/src/layer_uniforms.rs` — set the 3 new fields in **both** packers (L144 and L223) + `_pad_alpha: 0.0`.
4. `core/render_loop/shaders/slice_world_space_masked.wgsl`
   - Extend `LayerData` (L26) with the 4 fields after `_padMask1` (offsets 160–172), bump the size comment.
   - Insert modulation block in `sampleLayer` after the threshold switch (after L375), before the `has_alpha_mask` block.
5. `core/render_loop/shaders/slice_world_space_optimized_masked.wgsl`
   - Same `LayerData` extension after `_padOpt1` (L66).
   - Insert modulation after the threshold if/else (after L370), before `has_alpha_mask` (L372) and before the `alpha <= 0` early-exit (L381).
- **Verify:** `cargo build -p render_loop`, `cargo test -p render_loop` (shader compile tests + layer-uniform tests), `cargo clippy -p render_loop`.

### Phase 2 — Plumbing UI → GPU
- Thread `alphaModMode` / `alphaGamma` / `alphaCenter` through the declarative render path:
  `ViewLayer` (`ui2/src/types/viewState.ts`) → `buildSingleViewRenderPayload` (`ui2/src/services/apiService.ts`) → `LayerConfig` (render_contracts/bridge_types, `#[ts(export)]`) → `LayerInfo`.
- Extend `LayerPatch` (`core/bridge_types/src/lib.rs`) + the `patch_layer` handler for incremental slider drags.
- Regenerate bindings: `cargo xtask ts-bindings`.
- **Verify:** `cargo test -p api-bridge`, `cargo xtask ts-bindings` clean, TS compiles.

### Phase 3 — Inspector UI
- New "Alpha" subsection in the Mapping section of `ui2/src/components/panels/LayerInspectorContent.tsx` (next to Opacity/Threshold):
  - Off/Linear/Gamma segmented toggle (reuse the `InterpolationToggle` button-group pattern).
  - γ `SingleSlider` (shown when mode = Gamma).
  - Tiny SVG curve sparkline (~40 lines, no dep): alpha-vs-value across the live window with the threshold marked; optional faint histogram backing.
  - Disable the subsection when blendMode ∈ {max, min} with a tooltip.
- Wire through `useLayerRenderUpdater` (`inspectorAnnotatePanel.helpers.ts:183`) like opacity/threshold.
- **Verify:** `pnpm --filter ui2 test` (add a render/sparkline test), `pnpm lint`, manual `cargo tauri dev` smoke on `era_diag_minus_off`.

### Phase 4 — Polish + review
- Fresh-context code review (separate subagent).
- Optional: persist alpha-mod in saved layer presets; add to comparison/mosaic payloads if they diverge from the single-view path.

## Rollback / safety
Every layer defaults to `alpha_mod_mode = 0` (Off) end-to-end, which is byte-identical to current rendering. The feature is purely additive; no existing path changes behavior until a user opts in per layer.
