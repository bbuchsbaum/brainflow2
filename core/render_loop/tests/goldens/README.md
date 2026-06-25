# Render goldens

Committed artifacts for the render-correctness harness in
`../render_golden_test.rs`.

- `render_golden_axial.rgba` — raw RGBA8 buffer (128×128, top-left origin) of the
  pinned deterministic volume + axial view. This is the authoritative baseline the
  test compares against.
- `render_golden_axial.png` — the same frame as a PNG, for human inspection only.
  Not read by the test.

## Commands

```sh
# Verify the current render against the committed golden
cargo test -p render_loop --test render_golden_test

# Regenerate after an *intended* visual change (then commit the artifacts)
UPDATE_RENDER_GOLDEN=1 cargo test -p render_loop --test render_golden_test
```

## Notes

- The `.rgba` baseline is machine-specific (captured on the dev adapter, Metal).
  The test uses an exact FNV fast path and falls back to a per-pixel tolerance
  sized for f16 texture quantization, so the upcoming native-dtype (f16) upload
  work should stay within tolerance; a real data/geometry regression will not.
- The harness is GPU-bound: with no WGPU adapter it prints `SKIP` and passes.
- `render_golden_detects_single_voxel_perturbation` needs no committed artifact —
  it renders before/after a 1-voxel edit in one process and asserts the diff is
  visible. That is the machine-independent proof the harness catches regressions.
