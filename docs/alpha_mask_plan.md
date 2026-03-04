# Alpha Mask Integration Plan

## Milestone 1 – Infrastructure (Feature flag only)
- [ ] Remove mask-atlas scaffolding and introduce default white mask texture.
- [ ] Extend MultiTextureManager to track per-layer mask textures with fallback.
- [ ] Update upload/clear commands to mirror volume texture lifecycle and toggle `has_alpha_mask`.

## Milestone 2 – Bindings & Shaders
- [ ] Expand texture bind-group layout to include mask texture array.
- [ ] Update slice shader layouts (runtime + optimized) to bind mask textures.
- [ ] Sample masks per layer (fallback texture yields 1.0) and multiply alpha.
- [ ] Keep everything under `alpha-mask` feature flag.

## Milestone 3 – Bridge & UI
- [ ] Wire bridge mask uploads to MultiTextureManager, handle default fallback.
- [ ] Mount ClusterTab, show mask status, hook Compute/Clear.
- [ ] (Optional) emit cluster navigation events when rows selected.

## Milestone 4 – Validation & Rollout
- [ ] Add small regression test for split-local-min CC behavior.
- [ ] Manual smoke with `alpha-mask` enabled (mask renders correctly).
- [ ] Decide when to flip feature flag on by default.
