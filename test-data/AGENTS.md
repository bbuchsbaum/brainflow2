<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-10 -->

# test-data - Test Fixtures

## Purpose
Repository of neuroimaging test data files used for unit testing, integration testing, and development. Contains NIfTI volumes, GIfTI surface geometries, surface overlay data, and reference datasets with caching infrastructure. Provides standardized test inputs for validating loaders, renderers, coordinate transforms, and visualization pipelines.

## Key Files
Located in subdirectories (see below)

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `unit/` | Small test files for unit tests (NIfTI volumes, GIfTI surfaces) |
| `refs/` | Reference datasets with cache directory and dataset catalog |
| `surfaces/` | Surface geometry files (fslr32k standard meshes) |
| `overlays/` | Surface overlay data files (currently empty placeholder) |

### unit/ - Unit Test Fixtures
Small, fast-loading files for unit tests:
- `toy_t1w.nii.gz` - Toy T1-weighted MRI volume
- `global_mask2.nii` - Binary mask volume
- `tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w.nii` - MNI152 template brain
- `bilateral_frontal_roi.func.gii` - Functional GIfTI ROI data

**Usage:** Unit tests that need minimal, fast-loading data

### refs/ - Reference Datasets
Larger reference datasets with caching:
- `datasets.yaml` - Catalog of available reference datasets
- `.gitignore` - Excludes cached data from version control
- Cache directory for downloaded/generated reference data

**Usage:** Integration tests, benchmarks, and development testing with realistic data

### surfaces/ - Surface Geometry
Standard brain surface meshes:
- `fslr32k/` - fsLR 32k vertex resolution surface meshes (standard for HCP)

**Usage:** Surface rendering tests, surface overlay visualization, coordinate mapping

### overlays/ - Surface Overlay Data
Surface-mapped data files (currently empty):
- Placeholder for functional activation maps
- Placeholder for statistical overlays
- Placeholder for parcellation labels

**Usage:** Testing surface data overlay rendering and colormapping

## For AI Agents

### Working In This Directory

**Using Test Data in Tests:**
```rust
// In Rust tests
use std::path::PathBuf;

let test_data = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    .join("../../test-data/unit/toy_t1w.nii.gz");
let volume = load_nifti(&test_data)?;
```

```typescript
// In TypeScript tests
const testDataPath = '/Users/bbuchsbaum/code/brainflow2/test-data/unit/toy_t1w.nii.gz';
const volumeId = await api.loadFile(testDataPath);
```

**Adding New Test Data:**
1. Choose appropriate subdirectory:
   - Small files (<10MB) → `unit/`
   - Large reference data → `refs/` (update `datasets.yaml`)
   - Surface meshes → `surfaces/`
   - Surface overlays → `overlays/`

2. Add file and document in AGENTS.md

3. Update relevant test scripts in `../tools/`

**Test Data Guidelines:**
- Keep `unit/` files small for fast test execution
- Large files should be downloaded on-demand (see `refs/`)
- Use standard neuroimaging formats (NIfTI, GIfTI)
- Document source and preprocessing for reference data
- Include both valid and edge-case files for robust testing

**Common Test Scenarios:**
- Volume loading: Use `toy_t1w.nii.gz` or `global_mask2.nii`
- Coordinate transforms: Use `tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w.nii` (has standard affine)
- Surface rendering: Use `surfaces/fslr32k/` meshes
- Surface overlays: Use `bilateral_frontal_roi.func.gii`

### Testing Requirements

**Test Data Validation:**
```bash
# Verify test data exists
./tools/setup-test-data.sh

# List available test files
ls -R test-data/

# Check file integrity
file test-data/unit/*.nii.gz
file test-data/unit/*.gii
```

**Required Test Coverage:**
- All loader implementations must be tested with `unit/` fixtures
- Coordinate transforms validated against MNI152 template
- Surface rendering tested with fslr32k meshes
- Edge cases: Empty files, malformed headers, large dimensions

**Performance Benchmarks:**
- Unit test fixtures should load in <100ms
- Reference datasets cached to avoid repeated downloads
- Surface meshes optimized for 32k vertex standard

### Common Patterns

**Loading Test Volumes:**
```rust
// Unit test pattern
#[test]
fn test_volume_loading() {
    let path = test_data_path("unit/toy_t1w.nii.gz");
    let volume = load_nifti(path).expect("Failed to load");
    assert_eq!(volume.shape(), [64, 64, 64]);
}
```

**Using Reference Data:**
```rust
// Integration test pattern
#[test]
#[ignore] // Requires reference data download
fn test_with_mni_template() {
    let path = test_data_path("refs/mni152_t1w.nii.gz");
    ensure_reference_data_cached(&path);
    let volume = load_nifti(path).expect("Failed to load");
    // Test with realistic brain data
}
```

**Surface Mesh Testing:**
```rust
// Surface rendering test
#[test]
fn test_surface_rendering() {
    let surf_path = test_data_path("surfaces/fslr32k/L.midthickness.surf.gii");
    let surface = load_gifti_surface(surf_path).expect("Failed to load");
    assert_eq!(surface.vertex_count(), 32492); // fsLR 32k standard
}
```

## Dependencies

### Internal
- Used by all test suites in `../core/` workspace
- Referenced in `../ui2/` frontend tests
- Validated by scripts in `../tools/`
- E2E tests in `../e2e/` use this data

### External
No external dependencies (static data files), but adheres to standards:
- NIfTI-1 and NIfTI-2 file format specifications
- GIfTI (Geometry) file format specification
- HCP fsLR surface space standards
- MNI152 template space conventions

## Data Provenance

**MNI152 Template:**
- Source: TemplateFlow (via nilearn)
- Space: MNI152NLin2009cAsym
- Resolution: 1mm isotropic

**fsLR Surfaces:**
- Source: Human Connectome Project (HCP)
- Space: fsLR (Freesurfer Left-Right symmetric)
- Resolution: 32k vertices per hemisphere (standard)

**Toy Data:**
- `toy_t1w.nii.gz` - Synthetically generated for testing
- `global_mask2.nii` - Binary mask derived from real data

**Functional Data:**
- `bilateral_frontal_roi.func.gii` - Example functional overlay data

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
