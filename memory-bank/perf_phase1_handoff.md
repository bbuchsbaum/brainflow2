# Perf: load-to-first-pixel — hand-off (perf/phase1)

_Last updated: 2026-06-25. Tracker: **mote** (`.mote/`, not beads — the beads DB is empty/legacy). Umbrella: `bd-01KVZGXQCR…` "Perf: startup & load-to-first-pixel"._

## TL;DR
Five load-path perf wins shipped & verified this cycle, gated behind a render-correctness harness. Decode of a 1mm MNI dropped from ~60 ms of reorder-laden work to ~30 ms; GPU upload moved off the async reactor; CPU dtype no longer always f32. All changes are render-byte-identical (proven, not asserted). **Progressive low-res was investigated and deliberately NOT built** — measurement showed it's decode-bound and wouldn't help.

## ⚠️ Repo / branch state (read first)
- **brainflow on `perf/phase1`, UNPUSHED** (no upstream set). 7 commits added this cycle (see below). Main branch is `main`.
- **`neuroim-rs` is a PATH dependency** at `~/code/rust/neuroim-rs`. Cargo uses its **working tree**, not a pinned commit. It is on `main` @ `e4495e3` (pushed). Two neuroim commits this cycle: `6e88443` (native-dtype read) + `e4495e3` (column-major read). **If neuroim is ever checked out to an older commit, brainflow `perf/phase1` will fail to build** (missing `read_vol_native_as` / `read_vol_as_column_major`). Keep neuroim on `main`.
- **nifti crate version split**: neuroim uses `nifti 0.17`, brainflow's `core/loaders/nifti` pins `nifti 0.16`. Cross-crate `nifti` trait bounds must be named via a neuroim re-export (e.g. `neuroim::DataElement`), never the loader's own `nifti::`. See memory `neuroim-nifti-version-split`.
- A **debug `.app`** may still be running (`com.brainflow.dev`, `target/debug/bundle/macos/Brainflow.app`) — it's the build from before the column-major change; rebuild before live-testing that change.

## What shipped this cycle (brainflow `perf/phase1`)
Newest first; all render-byte-identical, all verified.
1. `dc38df0b` **column-major read** — load keeps the file's native x-fastest (Fortran) layout end-to-end instead of flipping C↔Fortran twice. **Decode 60.2 → 29.7 ms (−51%)** uncompressed MNI 1mm. (neuroim side: `read_vol_as_column_major`, `e4495e3`.)
2. `fbad0146` **off-reactor convert** — `request_layer_gpu_resources` Arc-clones the volume, drops the registry lock, runs convert+GPU-write on `spawn_blocking` (`blocking_lock`), re-acquires the render-service guard only for post-upload bookkeeping. **Live-verified** (MNI 1mm renders, no hang, UI interactive).
3. `d616de73` **`values()` elimination** — `DenseVolume3::values_contiguous()` returns a zero-copy `Cow` borrow of the Fortran-contiguous buffer; the GPU converters use it instead of rebuilding the voxel Vec each upload.
4. `704fd80d` **native-dtype decode** — unscaled int16/u16/i8/i32/u32 load in their native dtype (int16 = 2 B/voxel, not 4). Scaled & float keep f32. u8 deliberately excluded (see gotchas).
5. `29b803e7` **R16Float golden** + `31be7d71` **render-golden harness** + `bc902cd7` **harness compile fix** — the correctness gate for all of the above.

(Pre-cycle commits also on the branch: `bd0130d7` single-pass f16/f32, `a8b21ed8` Arc registry, `07662080`/`d68da243`/`718a7587`/`1bd183ec` earlier startup/load work.)

## Verification — how to check it's still good
```sh
# Render-correctness gate (renders a fixed volume+view, compares to committed golden,
# + 1-voxel sensitivity + i16==f32 equivalence). GPU-bound; soft-skips if no adapter.
cargo test -p render_loop --test render_golden_test
#   regenerate goldens after an INTENDED visual change:
#   UPDATE_RENDER_GOLDEN=1 cargo test -p render_loop --test render_golden_test

# Loader correctness (native dtype, scaled-int guard, column-major == c-order values)
cargo test -p nifti-loader

# Decode timing (set env to real volumes; #[ignore])
BF_PERF_NII=<abs.nii> BF_PERF_NII_GZ=<abs.nii.gz> \
  cargo test -p nifti-loader --release perf_baseline_load -- --nocapture --ignored
# Reorder micro-bench (documents the cost that motivated the column-major change)
cargo test -p volmath --release perf_reorder_cost -- --nocapture --ignored

# neuroim must stay green (shared crate)
cargo test --manifest-path ~/code/rust/neuroim-rs/Cargo.toml
```
**Known pre-existing red (NOT ours):** `render_loop` `test_colormap_indices` (c8eb1529 alpha-overlay tint) and a few `clippy::erasing_op` errors in `render_loop` `test_fixtures.rs`/`lib.rs`. Don't chase these as regressions.

## Current load-to-first-pixel profile (MNI152 T1w 1mm, 8.5M voxels, f32, release)
| Stage | Cost | Notes |
|---|---|---|
| decode (gzip inflate + f32 materialize) | **~30 ms** uncompressed / ~79 ms gz | was 60/92 before column-major change |
| └ of which gzip inflate | ~32–49 ms (gz only, noisy) | **now the largest single chunk for `.gz`** |
| convert f32→f16 + GPU upload | tens of ms, **off-reactor** | zero-copy read via `values_contiguous` |
| GPU render (request_frame) | ~2 ms | from live log |

## Gotchas / invariants (don't regress these)
- **Scaled ints must stay f32.** Native int storage only when `scl_slope ∈ {0,1} && scl_inter == 0`. Storing scaled ints natively truncates physical values (the reverted "PR #2" bug, `9232cd68`). Guard lives in `core/loaders/nifti` `try_load_native_3d`; tests `auto_load_keeps_scaled_int16/uint16_as_f32`. Memory: `scaled-int-nifti-corruption-guard`.
- **u8 is NOT taken natively.** A `VolU8` uploads as R8Unorm (normalized [0,1]) vs the f32 path's R16Float (raw) — going native would change u8 renders. `render_loop/src/lib.rs:1570` selects the format. Re-enabling u8 needs the R8Unorm intensity path verified against the golden. Tracked in `bd-01KVZPCN…`.
- **GPU-bound volumes are Fortran (x-fastest).** `DenseVolume3::from_data` builds Fortran; the column-major read keeps it; `values_contiguous` only borrows zero-copy when the array is F-contiguous (else falls back to `values()` rebuild). The GPU texture + NIfTI file are also x-fastest — keep this alignment.
- **Golden harness uses synthetic volumes** (`register_volume_with_upload`), so it does NOT exercise the loader/neuroim decode path. Loader correctness is covered by `nifti-loader` value tests + the `column_major_read_values_match_cstandard` equivalence test, not the golden.
- **off-reactor lock discipline**: the blocking upload task needs ONLY the render-service lock; async holders must release it without awaiting the task (no cycle). Don't hold a render-service guard across the `spawn_blocking`.

## Open work (mote) & recommendations
- `bd-01KVZGZR3N5R48MCHVEFEK5XZY` **progressive low-res** (p2) — **deprioritized, measured.** Decode-bound; can't reduce the ~70% spent in decode. Only worth it for very large/4D volumes or uncompressed-mmap (strided low-res). Don't build without a new motivating measurement.
- `bd-01KVZGZRZGP7…` **mmap + parallel gzip + decoded cache** (p3) — attacks the remaining decode cost; the biggest single chunk for `.gz` is now the ~32 ms gzip inflate. **Quick grab: swap flate2/miniz_oxide for libdeflate (~2–3× faster inflate, ~15–20 ms).** Bigger: mmap strided reads + decoded-volume disk cache for instant repeat loads.
- `bd-01KVZGZS46M…` **init double-init** (p3, independent) — serialize `init_render_loop` GPU init under the slot lock.
- `bd-01KVZPCN…` **u8 (via R8Unorm) + 4D native decode** (p3) — follow-ups deferred from native-dtype.

## Suggested next step
If continuing load perf: **libdeflate** for the gzip inflate (now the dominant `.gz` cost) — small, low-risk, targeted. Otherwise this is a clean point to **push `perf/phase1`** (and optionally a fresh-context review pass over the 7 commits) before more beads.
