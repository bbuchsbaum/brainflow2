# NeuroTabs Compatibility

Brainflow uses **NeuroTabs** as the user-facing name for Set Studio manifest import.

The file format compatibility target is the upstream NFTab 0.1 `table-package` contract from `/Users/bbuchsbaum/code/neurotabs`, especially:

- `spec/nftab-spec.md`
- `spec/nftab-manifest.schema.json`
- `inst/examples/faces-demo/`
- `inst/examples/roi-only/`

Implementation notes:

- UI labels, command palette entries, seeded examples, placeholders, and user docs should say `NeuroTabs`.
- Rust code and developer docs may say `NFTab` only when referring to upstream spec compatibility or a typed compatibility module.
- Brainflow should accept upstream-compatible manifests named `nftab.yaml`, `nftab.json`, `*.neurotabs.yaml`, or `*.neurotabs.json`; the filename is not the contract.
- Compare readiness must be derived from structural validity, source/resource resolution, and support compatibility, not from declared labels alone.
