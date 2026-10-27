# Shader and Rust display repairs

Scope: the eight findings from the 2026-10-25 shader/display review. Synthetic
fixtures exercise actual Metal rendering; no visual baselines were regenerated.

| Finding | Implemented behavior | Regression evidence |
| --- | --- | --- |
| 1. Ignored upload format / finite overflow | Explicit formats are honored and registry metadata follows the allocation. Automatic uploads encode half precision in one pass, retry in full precision on overflow/underflow, and reject values outside supported float range. Label-aware uploads require exact IDs. Automatic resident slots promote in place, with conservative image-set byte reservations; bridge responses report actual storage. | Requested format inspection; 70,000-value pixel oracle; failed allocation leaves slots available; precision/label encoder tests. |
| 2. Incomplete optimized fullscreen quad | Both active shaders use `fullscreen_vertex.wgsl`. Embedded sources remain complete WGSL; watched/raw fragments pass through `compose_shader_source`. | Standard/optimized pixel equality, Naga reflection and native shader validation. |
| 3. Dropped adapter options | One mapper honors display windows, nearest/linear interpolation and inclusive thresholds. New `Inside = 4` retains a range; existing `Range = 0` still hides it. The imperative adapter uses the canonical exact frame. Cubic requests fail explicitly. | Analytic grayscale ramp and inclusive boundary pixels, both shader variants, different nearest/linear results, contract serde tests. |
| 4. Missing final CPU voxel plane | The reference renderer uses the common CPU trilinear sampler. It preserves the existing/GPU half-open domain `[0, dimension)` with upper-edge replication, including singleton dimensions, and rejects non-finite coordinates. | Final-plane, singleton, edge-replication and out-of-domain tests. |
| 5. Unsupported texture capacity | Requests above 13 fail before adapter/device setup; smaller requests retain the fixed 13-slot shader layout. | Capacity-14 error regression and existing smaller-capacity facade smoke test. |
| 6. Native U8 contrast collapse | Default U8 uploads retain physical values in float textures. Explicit R8Unorm remains a documented range-normalized format; normalization uses floating arithmetic before division and metadata uses normalized display units. | Native-U8 versus F32 rendered ramp; intermediate normalized levels; finite range-overflow rejection. |
| 7. Duplicate targets / missing release | Bridge preparation and declarative rendering share `ensure_view`. Facade consumers can release individual/all view targets, and final volume teardown clears retained views. | No legacy target allocation on the declarative path; release/recreate readback; final-volume teardown regression. |
| 8. Full-volume row-padding copies | Volume upload and update share one tightly packed queue-write helper and encoder. Encoder buffer copies/readback retain their required alignment. | Odd-width, multiple-row, multiple-plane upload/update equality plus an independent per-pixel analytic oracle in R8, R16F and R32F. |

The active texture layout requires `FLOAT32_FILTERABLE` for R32Float. When that
capability is unavailable, an upload that needs full precision returns an error
instead of silently reducing its range. `R16Uint` remains unsupported by the
active float-sampling pipeline. Explicit R8Unorm windows/thresholds are in `[0,1]`
units; ordinary automatic uploads use source intensity units.

The first broad test run exposed old fixtures requesting half precision for
65,535, an ignored R16Uint request, and a raw-shader compiler bypassing source
composition. Fixtures now request supported, adequate precision; the half-float
rejection and allocation rollback remain explicitly asserted.

Verification receipts and complete logs are retained at
`/private/tmp/brainflow-shader-fixes/`. The initial sandbox GPU attempt could not
obtain an adapter; native runs are the GPU evidence. During work another session
advanced HEAD from `41953c2f6d255d143ee79a4c71226510fd41db25` to
`f45cc5aaec4e926780173e9d335dbecd0d65538f`, including some CPU/bridge changes.
Those changes were preserved; final evidence is tied to file hashes as well as HEAD.

## Validation results

- Full workspace tests passed: 886 passed, 29 ignored. After the resident-slot
  precision and budget follow-through, all four affected crates passed again:
  492 passed, 23 ignored.
- After the final bridge metadata change, the native GPU regressions, unchanged
  render goldens and shader contracts passed (19 tests), as did the bridge suite
  (204 passed, 3 ignored). The final lint-only adapter adjustment passed its
  three focused unit tests.
- Workspace Clippy, formatting, TypeScript binding generation and the API package
  build passed. Existing unrelated warnings remain; the adapter's redundant
  clone was removed and renderer Clippy rerun. Scoped diff whitespace checks passed.
- Apple M3 Max / Metal release benchmarks completed with 10 samples. Criterion
  intervals: 512px render plus readback 1.6833–1.7325 ms; submit-only render
  58.933–60.673 µs; existing 256³ R32F buffer-copy upload benchmark
  446.89–453.78 µs. The upload benchmark does not measure the changed conversion
  and queue-write path, and submit-only time does not measure GPU completion.

Exact commands, source hashes, phase boundaries and complete logs are recorded
in `receipt.json` in that log directory. Performance measurements are short
current-build observations, not a before/after speedup claim. Cross-platform and
interactive desktop acceptance are outside these checks. Ignored tests remain
unqualified; passing suite counts do not certify those cases.
