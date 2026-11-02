# Editable label storage

Transport-neutral sparse u16 label/provenance storage and atomic label NIfTI export.
No Tauri, bridge, session policy or GPU dependencies. Session code owns label-table,
constraint and workspace rules. Edits validate in full before changing any voxel.

Coordinates are zero-based voxel indices (x fastest). Source NIfTI qform and sform
are preserved independently; the writer never derives one from the other.
Run `cargo test -p label-store` and keep asymmetric fixtures that expose axis swaps,
invalid-edit atomicity, revision conflicts, and exact undo/redo (including provenance).
