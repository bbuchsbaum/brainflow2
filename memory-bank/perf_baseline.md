# Performance Baseline — startup & load-to-first-pixel

Captured before any optimization work, so Phase 1+ changes can be measured
against real numbers rather than asserted. Machine: dev macOS (Metal GPU).
Build: `--release` for Rust timings, production `vite build` for the bundle.

Benchmark volume: `test-data/unit/tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w.nii`
— MNI152 **193 × 229 × 193 = 8,530,021 voxels, f32 on disk (33 MB raw, 4.2 MB gzip)**.
A realistic structural; stat maps / 4D series will scale up from here.

## Measured numbers

### Backend load (CPU, on the async runtime today)
| Step | Time | Notes |
|---|---|---|
| Decode `.nii` (uncompressed) | **59 ms** | gzip inflate skipped |
| Decode `.nii.gz` | **99 ms** | gzip inflate adds ~40 ms |
| Histogram: deep clone | 1.5 ms | clone is cheap in time; cost is ~34 MB RAM |
| Histogram: `values()` rebuild | 16.2 ms | neuroim rebuilds the Vec each call |
| Histogram: min/max + 256-bin scan | 8.3 ms | |
| **Histogram total** | **~26 ms** | currently `await`ed before first pixel |

Decode runs **directly on the Tokio reactor** (`core/api_bridge/src/lib.rs` `load_file`,
no `spawn_blocking`), so this ~100 ms blocks all other app interaction. The
histogram is `await`ed in `ui2/src/services/LayerApiImpl.ts` before the layer
renders. Per-load critical-path CPU ≈ **decode (~100 ms) + histogram (~26 ms) ≈ 126 ms**,
plus the convert→f16 upload passes (not isolated; `values()` alone is 16 ms, so
the multi-pass converter is likely tens of ms more).

### GPU (cheap)
| Step | Time | Notes |
|---|---|---|
| Texture upload (256³ R32F) | **0.46 ms** | `copy_buffer_to_texture`; not a bottleneck |
| Render frame 512² (draw + readback) | **1.56 ms** | per slice/scroll |
| Render frame 512² (draw only) | **0.063 ms** | skip_readback |
| → blocking readback alone | **~1.5 ms** | **96% of render time**, every frame |

Plus ~1 MiB **raw uncompressed RGBA** crosses the IPC per rendered slice
(`render_view` default `RawRgba`).

### Frontend bundle (cold-start cost)
| Asset | Raw | Gzip |
|---|---|---|
| `index-*.js` (single monolith) | 2.3 MB | **680 KB** |
| all other chunks combined | tiny | <5 KB |
| total `dist/assets` | 2.5 MB | — |

No code-splitting; Three.js + surfview (~550 KB+) are eagerly bundled even
though cold start renders only slices. Backend `.setup()` is sub-millisecond.

## Takeaways for the optimization phases
- **Load:** the win is CPU scheduling, not raw speed — move decode + upload off
  the reactor (`spawn_blocking`) and take the histogram off the first-pixel path.
  GPU upload is already cheap.
- **Interaction:** the synchronous readback (~1.5 ms) + 1 MiB/frame IPC dominate
  scrolling, not the draw (63 µs).
- **Startup:** dominated by the 680 KB-gzip monolith; the lever is code-splitting
  / lazy-loading the surface path, not backend work.

## How to reproduce / capture before-after

Headless (no GUI), gives the decode + histogram numbers above:
```sh
# Make a gzipped MNI next to the uncompressed one, then:
BF_PERF_NII=/abs/mni.nii BF_PERF_NII_GZ=/abs/mni.nii.gz \
  cargo test -p nifti-loader --release perf_baseline_load -- --nocapture --ignored
```

GPU upload + render:
```sh
CRITERION_DEBUG=1 cargo bench -p render_loop_benches --bench upload
CRITERION_DEBUG=1 cargo bench -p render_loop_benches --bench render_time
```

Frontend bundle:
```sh
pnpm --filter temp-ui build   # then inspect ui2/dist/assets/*.js sizes
```

End-to-end, in the running app (build a debug `.app`, load a file, read the
tauri log):
- Backend: grep `[perf] load_file decode` and the `Successfully loaded volume …
  elapsed=…ms` line for the decode-vs-total split.
- Frontend: `[perf][startup] nav -> main.tsx eval` and `nav -> first paint`
  (console); set `DEBUG_VOLUME_LOADING` to emit the per-step
  `[VolumeLoadingService Xms]` load breakdown.

## Instrumentation added on this branch
- `core/api_bridge/src/lib.rs` — `[perf] load_file decode` timing.
- `ui2/src/main.tsx` — `[perf][startup]` nav→eval and nav→first-paint markers.
- `core/loaders/nifti/src/lib.rs` — gated `perf_baseline_load` test (`#[ignore]`).
