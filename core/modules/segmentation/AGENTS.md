# Segmentation domain

Transport-neutral sessions and manual rasterization. No Tauri, api-bridge or GPU.
The bridge adapter owns volume/GPU leases and workspace lifecycle. Every document
operation checks workspace instance, session identity and revision before work.

The label store owns sparse voxels, provenance and exact undo/redo. All tools use
one constraint gate; a lock protects a label even when hidden and in paint-over
all mode. Rasterization uses voxel centres and physical millimetres on the source
affine. Preview and commit call the same rasterizer. Test with known oblique and
anisotropic grids rather than image snapshots alone.
