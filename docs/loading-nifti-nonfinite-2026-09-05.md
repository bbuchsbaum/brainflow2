# NIfTI loading with missing voxel values

The reported remote statistical image downloaded and decoded successfully, then
failed during GPU allocation. The frontend hid the useful backend error behind
`Failed to load …: undefined`.

## Reproduction

Inspection of the downloaded float32 NIfTI found a 97 × 115 × 97 volume with
157,979 finite voxels and 924,056 NaNs. Its finite range was approximately
−17.399017 to 6.567617. Decoding the same cached file and calling the bridge's
real GPU upload command reproduced a panic in `neuroim::NeuroVol::min`:
`partial_cmp(...).unwrap()` could not compare a NaN. The bridge returned an
`Internal` error with code 5099; the UI incorrectly cast that structured payload
to a JavaScript `Error` and read its absent `message` property.

The cached source file was inspected without changing it. No new transfer from
the user's SSH host was needed to isolate this failure.

## Changes

- `neuroim` extrema ignore nonfinite floating-point values and return `None`
  when no finite values exist. Integer extrema still compare the original
  integer values, preserving precision. Brainflow pins upstream commit
  `78d4e61f3e7dc7e759f38d02b85f9da41ee70d8a`.
- `neuroatlas` uses the same `neuroim` revision, avoiding duplicate versions in
  the dependency graph. Its dependency-only update is
  `6f0adb62b858b3799982224fe04394c9e28a38ce`.
- Both active masked slice shaders return transparent pixels for sampled NaN
  and infinity values. A bit test of the float exponent avoids relying on NaN
  comparisons that GPU compilers may optimize away. Finite values continue
  through the existing intensity, threshold and colormap paths.
- File and volume loading normalize bridge rejections into actual `Error`
  objects, retain the original payload as `cause`, and send the extracted
  message to Activity, error events and notifications. Existing rollback and
  cancellation behavior remains covered by the loading tests.

## Verification

- Upstream `neuroim`: 135 tests passed across library, extrema, volume and slice
  tests. The new regression failed before the fix with mixed NaN/finite input
  and with all-nonfinite input. Integer precision and empty input are covered.
- Upstream `neuroatlas`: 247 library tests passed, 5 ignored.
- `cargo test --locked -p render_loop`: 205 passed, 19 ignored. The new Metal
  pixel test compares a nonfinite overlay against an explicitly masked
  reference over a visible base volume, checks NaN and both infinities, and
  verifies that finite overlay values actually draw. It reproduced opaque
  black pixels before the shader fix. Render goldens and shader contracts pass.
- `cargo test --locked -p api-bridge --lib --test gpu_upload_tests`: 150 passed,
  2 ignored, including the local SFTP success/cancel/stall/retry fixture.
- Focused UI loading, remote mount and error formatting tests: 28 passed.
  TypeScript project compilation (`tsc -b`) passed.
- The optional `local_nifti_decode_and_gpu_upload` bridge test uploads the actual
  cached image with the final dependency pins, verifies a finite display range,
  and releases its GPU resources. To repeat it with a local 3D float32 NIfTI:

  ```sh
  BRAINFLOW_TEST_NIFTI_PATH=/path/to/image.nii.gz \
    cargo test --locked -p api-bridge --test gpu_upload_tests \
    local_nifti_decode_and_gpu_upload -- --ignored --nocapture
  ```

These checks cover decoding, GPU allocation, pixel compositing and error
presentation independently. They do not constitute a new native UI click-through
against the user's live SSH host.
