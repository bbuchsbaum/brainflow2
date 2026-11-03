# Phase 3 design: one backend owner for GPU residency

**Status:** approved by the user on 2026-11-02, with the recommended answers to the open questions (see "Decisions"). The source is a design agent's reading of `fix/gpu-residency` at 17 commits past `d2157d96`.

**Path shorthands:** `lib.rs` is `core/api_bridge/src/lib.rs`; `mtm.rs` is `core/render_loop/src/multi_texture_manager.rs`.

## Problem after Phases 0–1

There are still two sets of books: one in the UI, one in the backend, kept in step by events.

**UI**
- `LayerEvictionService`: `makeRoomForUpload`, its queue and reservations, the eviction tiers, and the pins.
- `frontWorkspaceResidency`.
- Adoption of layers the backend already holds (the 1006 case).
- `AtlasPressureMonitor`, which removes whole layers under pressure.

**Backend**
- Residency state is spread over five maps (`layer_to_atlas_map`, `layer_leases`, `resident_image_sets`, `render_skipped_layers`, `layer_last_drawn`).
- Uploads come from two paths:
  - `request_layer_gpu_resources`, which holds `volume_operations`;
  - lazy allocation on the render path, which holds only the service lock. These allocations get **no lease**, so the watchdog can't see them.
- The lazy path uploads VolU16 with the plain upload (`lib.rs:7988`), not `upload_editable_labels`. This is the root cause of N34.
- 4D rings take any free slot, up to 6 per layer.
- Slot indices are bare `u32` and get reused. Only editable textures carry a generation, so a stale lease or a `ProvisionalUpload` can free another layer's slot.
- The UI detects "slots full" by matching the error text with a regex.

## Design

### 1. Single owner

- New module: `core/api_bridge/src/residency/`.
  - A pure `ResidencyPolicy` sits behind a `TextureBackend` trait, so it can be tested with a fake backend.
  - Async glue lives in `manager.rs`.
  - Its state is `BridgeState::residency`.
- Per-layer state:
  - the slot handle, as `{index, generation}`;
  - the lease;
  - when the layer was last drawn;
  - which frames demand it;
  - pins, each with a reason: `FrontFrame`, `StudioPane`, `SegmentationSession` or `EditableDocument`;
  - its state: `Resident`, `Uploading`, `Refused` or `Evicted`.
- Per-frame demand: the layers in stack order, an epoch, a priority and `last_front_at`.
- Ring accounts, which hold slot counts only.
- **Lock order:** `volume_operations` → outer `render_loop_service` → `RenderLoopService` → `residency` → `resident_image_sets` → `volume_registry` → leaf maps. This matches the existing code paths. Every change of slot ownership holds both the service lock and `residency`.

### 2. Demand model: the UI declares

Inferring demand at render time doesn't work:
- background tabs never render;
- renders carry no frame identity;
- pins are invisible to the renderer.

New commands:
- `set_residency_demand { frameId, epoch, priority: Front | Visible | Background, layers: [{layerId, volumeId, pin?}] } → ResidencyReport`
- `clear_residency_demand { frameId, epoch }`
- `get_residency_state`

`request_layer_gpu_resources` becomes idempotent (`manager.ensure`), so the 1006 error disappears.

### 3. Policy

**Admission:** use a free slot. Failing that, evict in this order:
1. cached ring members (LRU);
2. layers no frame demands (LRU by last drawn);
3. layers demanded only by background frames (oldest `last_front_at`, then last drawn).

**Never evicted:** layers demanded by a Front or Visible frame, pinned layers, the displayed ring member, and in-flight uploads.

**If nothing can be evicted:** return a typed refusal, with one of these reasons:
- `FrontExceedsBudget`
- `HeldByPinned`
- `DrawCap`
- `VolumeMissing`
- `UploadFailed`

This replaces the regex.

**Rings:** they draw from the global pool, using only slack: capacity minus resident primaries minus 1 slot of headroom. The slack is shared among Front/Visible rings. Background rings shrink to their displayed member. The fixed 6 per layer is removed.

**Hysteresis:**
- Eviction is lazy: it happens only under admission pressure.
- A frame that was in front within the last 3 s ranks last among background frames.
- Cancelled uploads still install, as layers no frame demands.

**More than 13 layers in the front frame:** admit them in stack order from the bottom up, refuse the rest with one alert, and never evict front layers to make room.

**Draw cap:** check it against demand. The render-time OverCap skip stays as a guard.

### 4. Re-upload

There is a single `upload_for` function, which re-uploads from the CPU copy in the `VolumeRegistry`. How each kind of volume is handled:

| Volume | Handling |
|---|---|
| Plain files, templates | Re-uploaded from the registry. |
| Remote files | Have a local copy, so they re-upload like plain files. |
| Provisional volumes | Not admitted until they are published (the `ProvisionalUpload` → lease hand-off). |
| Studio maps | Ordinary registry volumes. A borrowed underlay is a demand on the workspace's layer. |
| 4D | The primary is re-extracted; ring members are rebuilt on demand. |
| **Editable labels** | Always go through `upload_editable_labels` at the current revision, then bind, then a full sync. This closes N34. |

**Avoiding blank frames:**
- Front demand is sent before a tab swap, with a wait of about 150 ms.
- Front layers are never evicted.
- Timepoint re-uploads allocate the new slot before releasing the old one.
- Render reports demanded-but-missing layers, so the UI can show a "loading" badge.

### 5. Events and UI

- A single `residency-changed {seq, freeSlots, budget, layers[{id, state, refusal?}]}` event, mirrored in a `residencyStore`, replaces `layer-gpu-released`, `layer.gpu.evicted` and `gpu.slots.freed`.
- **Deleted:**
  - most of `LayerEvictionService`, including the room queue, reservations, eviction and pins;
  - all of `frontWorkspaceResidency`;
  - the adoption code in `LayerApiImpl`;
  - Studio's makeRoom calls;
  - `AtlasPressureMonitor` eviction.
- **New:** a `ResidencyDemandPublisher`. It follows workspace view states, the active workspace, Studio mounts and segmentation sessions.

### 6. Async ownership

- **Per-slot generations:** every upload bumps the slot's generation. Releasing with a stale handle does nothing. Leases, rings and `ProvisionalUpload` all hold handles.
- **Ordering:** each frame's epochs increase monotonically, events carry a sequence number, and frame identity is captured before I/O.
- **Uploads as tickets:** each upload is a ticket that can be cancelled until the GPU write starts, and is installed only if its generation still matches.
- **Removal:** `forget` runs under `volume_operations`.
- **Watchdog:** it becomes a manager sweep that takes `volume_operations`, and it releases only layers that are undemanded, unpinned and stale.

### 7. Increments (each shippable on its own)

1. The pure policy and a fake backend, running in shadow mode next to today's behaviour. Unit tests cover:
   - the eviction order and pins;
   - more than 13 layers in front;
   - the ring allowance, hysteresis and stale epochs.
2. Generation handles, leases for every allocation, and editable VolU16 routing. **This increment is Phase 2 (N34).**
3. The demand commands and the `residency-changed` event, with the UI still owning the policy.
4. The backend owns admission and eviction behind `BRAINFLOW_BACKEND_RESIDENCY`, with the UI path as fallback. The UI book-keeping is deleted.
5. The ring global pool.
6. Old paths and the flag removed, and the docs updated. Native checks:
   - rapid switching across 3 tabs × 6 layers;
   - a 15-layer front frame;
   - segmentation with ⌥-scroll;
   - discard leaves no slot behind.

## Decisions (user, 2026-11-02: "Accept recommendations")

1. **More than 13 layers in front:** admit bottom-up in stack order, then refuse the rest with one alert.
2. **No `Visible` priority for now:** Front plus Studio-pane and segmentation pins are enough. Add `Visible` only if a docked second-workspace layout becomes real.
3. **Feature flag:** delete the UI fallback and the flag as soon as the native checks for increments 4–5 pass.
4. **4D member swaps** stay on the service lock, with a registry re-check.
5. **Upload staging outside the service lock** is out of scope; it becomes a separate performance task.

## Open questions (as asked)

1. **More than 13 layers in front:** admit bottom-up in stack order and refuse the rest with one alert (recommended), or refuse the whole frame?
2. **A "Visible" priority** for a second docked panel that shows another workspace: pin it like the front frame, or are the front frame and Studio enough?
3. **Feature flag lifetime:** while the flag is on, two policies coexist. Delete the fallback straight after the native checks pass (recommended), or keep it for one release?
4. **Render-path 4D member swaps** stay outside `volume_operations`: rely on the service lock plus a registry re-check (recommended), or make them manager tickets, which adds a frame of latency?
5. **Uploads hold the service lock for the whole write.** Leave that as it is for now (recommended), or stage large uploads outside the lock? Staging is a separate performance task.
