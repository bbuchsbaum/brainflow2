ASEG retains the 17 sparse FreeSurfer voxel IDs (10–60) from the pinned
`neuroatlas` asset and the label order, colors and hemisphere definitions in
`R/aseg_subcort.R` at `eb2fc01572f72b600ead6348199f81ada9712880`.
The source volume SHA-256 is
`84ed9346436012fc7a87468bf99aa1a8ee3c41b6d616e29d4d1941ca81507291`.
No voxel relabeling is performed. Left-VentralDC is ID 28.

The pinned native `neuroatlas-rs` provider at
`6f0adb62b858b3799982224fe04394c9e28a38ce` incorrectly assigns sequential
1–17 IDs to this asset. Do not copy that mapping into this table. This browser
correction does not repair the upstream native provider.

Olsen retains the IDs, original display names and RGB values from
`src/atlas/olsen_mtl.rs` in that Rust revision. When updating either provider,
verify the downloaded voxel ID set against its label definitions, rather than
assuming region count equals maximum ID.
