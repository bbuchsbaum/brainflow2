# GPU texture exhaustion during image switching

The folder image-set workflow replaces its current volume by uploading the next
member, publishing it, then releasing the previous member. With a base image and
two image sets, the scene can contain three layers throughout that operation.

The bridge released `volume_atlas` bookkeeping but did not call the active
world-space texture manager's release path. Each replacement left a 3D texture
resident. A real Metal regression reproduced the reported `Maximum texture
limit 13 reached (code: 6001)` at upload index 13, despite retaining only three
active layers.

## Changes

- `RenderLoopService::release_layer_resources` removes the render layer and
  releases its allocation from the active backend. World-space teardown removes
  the texture, volume registration and metadata and rebuilds texture bindings.
- Manual release, timepoint invalidation, lease drop and watchdog cleanup use
  that path. Leases also reclaim any additional resident-ring members.
- The registry and watchdog now share an `Arc<LayerLease>`. Dropping a watchdog
  snapshot leaves the registered lease alive; only the last owner invokes drop
  cleanup. Previously, every clone of the wrapper ran its destructor.
- Texture release and clear remove associated alpha masks. A reused slot cannot
  inherit another volume's mask. Failed uploads leave slot capacity unchanged.

The shader's 13-slot limit is unchanged. A replacement temporarily needs one
additional slot while the old image remains available if loading fails.

## Verification

- `gpu_upload_tests::image_set_switches_reuse_gpu_textures`: three initial
  layers followed by 60 allocate-new/release-old replacements, alternating image
  dimensions and voxel values. Each step checks resident/free slot counts and
  renders all three layers through the same view ID. Center pixels must change
  with each member. Final teardown returns to zero resident slots and bytes.
- `layer_lease_ownership_and_teardown_reclaim_resident_textures`: watchdog
  snapshot ownership and manual, watchdog, last-owner drop, timepoint invalidation
  and pre-lease fallback cleanup, including a populated 4D resident ring.
- Texture-manager regressions cover failed uploads with fresh and recycled slots,
  mask removal, and clearing all allocations.

The full renderer suite passed (207 tests, 19 ignored), as did bridge unit and
GPU upload tests (152 tests, 2 ignored). The strengthened rendered-pixel switching
regression also passed. `cargo fmt --all --check` and the production TypeScript /
Vite build passed.

These checks exercise the real GPU and bridge. They do not constitute a native
UI click-through or a live SSH transfer test; file discovery and remote transfer
are unchanged.
