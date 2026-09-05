# Folder image sets

To browse several images using one scene layer, right-click a folder in Files
and choose **Open folder as image set…**. The same action is available from the
Files actions menu for the selected folder.

The dialog lists direct `.nii` and `.nii.gz` children in natural filename order.
All are checked initially. Uncheck unwanted files, optionally rename the set,
then choose **Open image set**. Filtering the list preserves checked files
outside the filter. Subdirectories are not scanned.

The Inspector shows one scene entry with an **Image set** section. Use the
member selector or previous/next buttons to choose the displayed image. The
current filename and position remain visible. Standard Render and Data controls
apply to that image. Contrast settings are remembered separately for each member;
the layer's visibility, opacity, position in the stack, view geometry and
crosshair stay in place when switching.

## Loading and ownership

`ImageSetService` owns discovery and selection, backed by `imageSetStore` so the
Files and Inspector roots share the same state. `OpenImageSetDialog` is hosted
once by `App` and portals to the document body. The folder browser does not need
to enter Set Studio or infer a cohort/design table.

Only the chosen image is decoded. Remote files use the existing mount-aware
`loadFile` path and its bounded disk cache. Switching back can reuse the downloaded
file; it still decodes and uploads that member. This feature does not preload
all members into RAM/VRAM or claim the co-registered GPU ring's constant-time
switching behavior. Each image retains its own geometry and scalar type.

`LayerLoadContext` supports a guarded replacement. The new volume is decoded,
validated and uploaded before the scene entry and workspace view layers are
replaced. Publication preserves layer order and view geometry and updates
Inspector selection and Compare panel references. The previous GPU allocation
and decoded volume are retired after publication. Thus a successful switch has
one visible member; an unsuccessful switch leaves the previous one intact.

The collection has a stable `imageSetId`; its active volume/layer ID changes on
replacement. Per-member display settings are saved at commit time, including
edits made while the next member loads. Each set serializes its work, and a
request token discards obsolete selections. Closed workspaces, dismissed initial
loads and removed sets cannot publish late results. Removing the layer also
removes its collection and display preferences. Sets are session-local.

## Verification

The service regression exercises the real volume/layer services and layer store
with backend I/O fixtures. It covers filtered membership, one-layer replacement,
per-member contrast, late edits, differing geometry, other layers/workspaces,
Compare references, GPU failure, rapid selection, removal, cancellation and
closed destinations. Component tests cover the checklist, loading/error states,
next/previous controls and the immediate folder context menu.

For a browser UI check, run the UI dev server and open
`/image-set-harness.html`. This development-only entry uses the real folder menu,
checklist, stores, layer lifecycle and Inspector picker with mocked backend I/O.
It is excluded from the production entry. The browser check verifies deselection,
member switching, one scene layer and no uncaught page errors. Real remote
transfer and GPU behavior continue to use the existing loading pipeline; the
browser fixture does not assert a live SSH/native-rendering click-through.
