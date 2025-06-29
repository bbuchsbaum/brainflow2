Okay, here is the finalized Test Data Strategy Guide, formatted as a Markdown document, incorporating the details discussed.

---

# `docs/DATA-fixtures.md`

**Version:** 1.0
**Status:** Adopted for Phase 1
**Date:** [Insert Date]
**Context:** This document defines the strategy for managing test data fixtures within the Brainflow project, ensuring consistentOkay, let's crystall and reproducible testing across local development environments and Continuous Integration (CI).

## 1. Goals

*   **Fast Clize the test data strategy into a formalized guide. This document clarifies where different types of test data reside, how they are managed,ones & CI:** Keep the core Git repository small and CI execution times low.
*   **Reproducible Testing:** Ensure and how developers and CI access them.

---

# `docs/DATA-fixtures.md`

**Version:** 1.0
**Status:** Adopted for Phase 1
**Date:** [Insert Date]
**Context:** Defines all developers and CI jobs use the exact same data for unit, integration, E2E, and performance tests.
*   **Developer Convenience:** Provide simple commands to acquire necessary test datasets locally.
*   **Avoid Repo Bloat:** Prevent large the strategy for managing test data fixtures (neuroimaging files) used for unit tests, integration tests, E2E tests, performance benchmarks, and manual QA within the Brainflow project.

## 1. Rationale & Goals

*   **Fast binary files from being committed directly to Git history.

## 2. Data Categories & Storage Strategy

We categorize test data based Clones & CI:** Keep the core Git repository small and fast to clone/checkout, especially for CI runners.
*   **Reproducibility:** Ensure tests run against consistent, versioned data across different environments (local dev, CI).
*   **Performance on size and usage:

| Data Category         | Purpose                                                  | Size Limit   | Storage Location             | Acquisition Method              |
| :-------------------- | :------------------------------------------------------- | :----------- | :--------------------------- | :------------------------------ |
| **Unit/CI Samples**   | Rust/TS unit tests, Playwright smoke tests, CI checks Benchmarking:** Provide access to larger, realistic datasets for performance testing without bloating the repository.
*   **Developer Convenience:** Make it easy for developers to obtain necessary test data locally.

## 2. Data Categories & Storage Strategy

We categorize test data based on size and purpose:

| Data Type                     | Purpose                                                  | Size Limit         | Location in Repo                         | ≤ 5 MB each  | `test-data/unit/`            | Git LFS (committed pointers| Storage Mechanism                                                                 | Access Method                 |
| :---------------------------- | :------------------------------------------------------- | :----------------- | :----------------------------------- | :-------------------------------------------------------------------------------- | :---------------------------- |
| **Unit/Smoke Test Samples**   )    |
| **Reference Datasets**| Manual QA, Performance benchmarks (FPS, upload speed)    | 100-500+ MB  | `test-data/refs/cache/`      | On| Rust/TS unit tests, Playwright smoke tests, basic CI checks | **≤ 5 MB** each    -demand script (`fetch:refs`) |
| **Overlay Examples**  | Visual regression tests, E2E screenshot comparisons      | ≤ 10 MB each | `test-data/overlays/`        | Git LFS (committed| `test-data/unit/`                    | **Git LFS** (tracked in `.gitattributes`)                                          pointers)    |

### 2.1. Unit/CI Samples (`test-data/unit/`)

*   **Content| Direct path access, Git clone |
| **Overlay Examples**          | E2E visual regression, specific overlay feature:** Small, representative files covering basic formats.
    *   `toy_t1w.nii.gz` (e.g., 64x64x32, float32)
    *   `toy_surface.gii` ( tests    | **≤ 10 MB** each   | `test-data/overlays/`                | **Gite.g., ~200 vertices/faces)
    *   `toy_atlas.nii.gz` LFS** (tracked in `.gitattributes`)                                         | Direct path access, Git clone |
| **Reference Dat (e.g., 64x64x32, int16, ~10 labels)
*   **asets**        | Manual QA, Performance benchmarks (FPS, load times)       | 100 MB - 1Storage:** Pointers committed to Git, actual files stored via **Git LFS**. Configured in `.gitattributes`.
*   **Ac GB+     | `test-data/refs/datasets.yaml` (Manifest Only) | **External Download +quisition:** Files are downloaded automatically during `git clone` or `git pull` if Git LFS client is installed. CI environments typically need LFS support enabled.

### 2.2. Reference Datasets (`test-data/refs/`) Local Cache** (Actual files *not* in Git)                     | Fetch script (`fetch:refs`)   |

### 2.4. Surface Mesh Test Data (`test-data/refs/`)

**GIFTI Brain Surface Files (Colin27, Left Hemisphere):**
- **White Matter Surface (.gii):**  
  A GIFTI-format cortical white matter surface mesh for the Colin27 template brain.  
  URL: [https://www.bic.mni.mcgill.ca/~noel/noel-myelin/COLIN27_FS/surf/lh.white.gii](https://www.bic.mni.mcgill.ca/~noel/noel-myelin/COLIN27_FS/surf/lh.white.gii)
- **Pial Surface (.gii):**  
  The outer cortical (pial) surface mesh for the Colin27 template.  
  URL: [https://www.bic.mni.mcgill.ca/~noel/noel-myelin/COLIN27_FS/surf/lh.pial.surf.gii](https://www.bic.mni.mcgill.ca/~noel/noel-myelin/COLIN27_FS/surf/lh.pial.surf.gii)
- **Inflated Surface (.gii):**  
  An inflated (smoothed) cortical surface for the Colin27 brain.  
  URL: [https://www.bic.mni.mcgill.ca/~noel/noel-myelin/COLIN27_FS/surf/lh.inflated.surf.gii](https://www.bic.mni.mcgill.ca/~noel/noel-myelin/COLIN27_FS/surf/lh.inflated.surf.gii)

**FreeSurfer ASCII Mesh Files (Brain for Blender, Full Cortex):**
- **Pial Surface (.asc):**  
  FreeSurfer ASCII mesh for the full cortex, from the "Brain for Blender" dataset.  
  Download tarball (contains `lh.pial.asc` and `rh.pial.asc`):  
  [https://brainder.org/download/brain-for-blender/?uuid=pial_Full_srf.tar.bz2](https://brainder.org/download/brain-for-blender/?uuid=pial_Full_srf.tar.bz2)
- **White Matter Surface (.asc):**  
  FreeSurfer ASCII mesh for the full cortex, from the same dataset.  
  Download tarball (contains `lh.white.asc` and `rh.white.asc`):  
  [https://brainder.org/download/brain-for-blender/?uuid=white_Full_srf.tar.bz2](https://brainder.org/download/brain-for-blender/?uuid=white_Full_srf.tar.bz2)

> All URLs are public and can be fetched with `curl` or `wget`. These files are standard, well-labeled, and suitable for use as test fixtures in surface mesh loader and rendering tests.

## 3. Repository

*   **Content:** Larger, real-world datasets for performance testing and manual validation.
    *   Open Layout (`test-data/`)

The finalized structure within the `brainflow/` repository root:

```
brainNeuro `ds000114` (sub-01 T1w, sub-01 funcflow/
└── test-data/
    ├── unit/                       # Small files (<5MB), committed via Git LFS
    │    BOLD)
    *   `fsaverage` surface (lh.pial, rh.pial)
    *   Schaefer 400 parcel atlas (e.g., 2mm MNI NIfTI)├── toy_t1w.nii.gz
    │   ├── toy_surface.gii
    │   └── toy_atlas.nii.gz
    │   └── ... (other small fixtures)
    ├── overlays
*   **Storage:** Only a manifest file (`datasets.yaml`) is committed to Git. This file contains URLs/                   # Medium files (<10MB), committed via Git LFS
    │   └── toy_zmap.nii and checksums (SHA-256) for each dataset. Downloaded files are stored locally in `test-data/refs/cache/.gz
    │   └── ... (other overlay examples)
    └── refs/                       # References to large external` (which is added to `.gitignore`).
*   **Acquisition:** Manually run `pnpm run fetch:refs` ( datasets
        ├── datasets.yaml           # Manifest: Keys, URLs, SHA256 hashes, expected size
        ├──or `cargo xtask fetch-refs`) script. This script reads `datasets.yaml`, downloads files if missing or cache/                  # Downloaded large files land here (GIT-IGNORED)
        │   └── .gitkeep checksum fails, verifies hashes, and places them in the `cache/` directory.

### 2.3. Overlay Examples (`test-data/overlays/`)

*   **Content:** Medium-sized files used for specific E            # Ensure dir exists but content ignored
        └── .gitignore              # Ignore the 'cache/' directory: `cache2E tests or visual regression.
    *   `toy_zmap.nii.gz` (Statistical/`
```

**`.gitattributes` Configuration (in repository root):**

```gitattributes
# Track map example)
    *   `toy_cluster_mask.nii.gz` (Example segmentation output)
*   **Storage:** Git LFS, similar to unit samples.
*   **Acquisition:** Automatic via `git clone`/`pull specific large file types in test-data/ via LFS
test-data/unit/** filter=lfs diff=lfs merge=lfs -text
test-data/overlays/** filter=lfs diff=lfs merge=lfs -text

` with LFS client.

## 3. Repository Layout

```
brainflow/
└── test-data/
    # Ensure yaml manifest is treated as text
test-data/refs/datasets.yaml text
```

*   *Note├── unit/                        # Small files, tracked by Git LFS
    │   ├── toy_t1w.nii.gz
    │   ├── toy_surface.gii
    │   └── toy_atlas.nii.gz
    ├── overlays:* Developers need Git LFS installed (`git lfs install`).

## 4. Reference Dataset Manifest (`datasets.yaml`)

This/                    # Medium files, tracked by Git LFS
    │   └── toy_zmap.nii.gz
     file defines the large datasets needed for performance testing and QA.

```yaml
# test-data/refs/datasets.yaml
#└── refs/                        # Large reference datasets (managed by script)
        ├── datasets.yaml            # Manifest: URLs + --- Required for Phase 1 Performance Gates & QA ---
ds000114_t1w:
   SHA256 hashes
        └── .gitignore               # Ignores 'cache/' subdirectory
        └── cache/                   description: "Sample T1w anatomical from OpenNeuro ds000114 (sub-01)"
  url# Downloaded large files land here (ignored)
            └── ds000114_t1w.nii.gz  : "https://openneuro.s3.amazonaws.com/ds000114/sub-01/anat/sub-01_T1w.nii.gz"
  sha256: "PASTE_COR# Example downloaded file
            └── ...
```

**.gitattributes Configuration:**

```
# Enable LFS forRECT_SHA256_HERE" # Replace with actual hash
  size_bytes: 245328 specific test data directories
test-data/unit/** filter=lfs diff=lfs merge=lfs -76 # Example size
  output_path: "ds000114/sub-01/anattext
test-data/overlays/** filter=lfs diff=lfs merge=lfs -text
```/sub-01_T1w.nii.gz" # Relative path within cache/

ds000114_bold:
  description: "Sample functional BOLD run from OpenNeuro ds000114 (sub-01,

**.gitignore Entry (for refs):**

```
# Ignore downloaded reference datasets
test-data/refs/cache/
```

## 4. Acquisition Scripts

*   **Primary Script (`tools/scripts/fetch-refs.ts task-fingerfootlips, run-1)"
  url: "https://openneuro.s3.amazonaws.com/ds000114/sub-01/func/sub-01_task-fingerfootlips_bold`):**
    *   Implemented using Node.js/TypeScript (e.g., using `axios` for downloads, `crypto` for hashing).
    *   Parses `test-data/refs/datasets.yaml.nii.gz" # Example URL, check correct run
  sha256: "PASTE_CORRECT_SHA2`.
    *   Checks for existence of target files in `test-data/refs/cache/`.
    *   56_HERE"
  size_bytes: 150000000 # Example size
  output_path: "ds000114/sub-01/func/sub-01_task-fingerfootIf a file is missing or its SHA-256 hash doesn't match the manifest, downloads it from the specifiedlips_bold.nii.gz"

fsaverage_lh_pial:
  description: "Frees URL.
    *   Shows progress during download.
    *   Verifies SHA-256 hash after download.
    *   Handles potential download/hash errors gracefully.
    *   Run via `pnpm run fetch:refs`.urfer fsaverage left hemisphere pial surface"
  url: "https://EXAMPLE_URL/fsaverage/
*   **Optional Rust Task (`cargo xtask fetch-refs`):**
    *   Can be addedsurf/lh.pial.gii" # Placeholder URL
  sha256: "PASTE_CORRECT_SHA256_HERE"
  size_bytes: 15000000 # Example size
  output_path: later if needed for specific CI environments or Rust-centric workflows.
    *   Mirrors the functionality of the Node.js "fsaverage/surf/lh.pial.gii"

fsaverage_rh_pial:
 script.

**`test-data/refs/datasets.yaml` Format Example:**

```yaml
ds000114_t  description: "Freesurfer fsaverage right hemisphere pial surface"
  url: "https://EXAMPLE_URL/fsaverage/surf/rh.pial.gii" # Placeholder URL
  sha256: "PASTE_COR1w:
  description: "Sub-01 T1w anatomical from OpenNeuro ds000114RECT_SHA256_HERE"
  size_bytes: 15000000"
  url: "https://openneuro.s3.amazonaws.com/ds000114/sub-01/anat/sub-01_T1w.nii.gz"
 # Example size
  output_path: "fsaverage/surf/rh.pial.gii"

schaefer400_atlas:
  description: "Schaefer 400 parcel atlas  sha256: "EXPECTED_SHA256_HASH_FOR_T1W_FILE" # Replace with actual hash
  size_bytes: 24532876 # Optional, for user feedback

ds000114 (MNI space, e.g., 1mm)"
  url: "https://URL_TO_SCHAEFER_400.nii.gz" # Placeholder URL
  sha256: "PASTE_CORRECT_SHA256_HERE"
  size_bytes: 5000000 # Example size
  _bold:
  description: "Sub-01 Task functional BOLD from OpenNeuro ds00011output_path: "atlases/Schaefer2018_400Parcels_7Networks4/sub-01/func/sub-01_task-linebisection_bold.nii.gz"
  sha_order_FSLMNI152_1mm.nii.gz"

# --- Add other256: "EXPECTED_SHA256_HASH_FOR_BOLD_FILE"
  size datasets as needed ---
```

## 5. Fetch Script (`tools/scripts/fetch-refs.ts`)

A script (likely TypeScript/Node.js using libraries like `axios` or `node-fetch`, and `crypto` for hashing_bytes: 150123456 # Example size

fsaverage_lh_pial:
  description: "Freesurfer fsaverage Left Hemisphere Pial Surface"
  url: "URL_TO_FS) will provide the mechanism to download and verify reference datasets.

*   **Command:** `pnpm run fetch:refs` (defined in root `package.json`).
*   **Functionality:**
    1.  Parses `test-data/refs/datasets.yaml`.
    2.  For each entry:
        *   Checks if the file exists at `test-data/refs/cache/{AVERAGE_LH_PIAL_GII" # Needs a stable URL or hosting
  sha256:output_path}`.
        *   If it exists, verifies its SHA256 hash against the manifest. If hash matches, skips download. If mismatch, logs error or re-downloads.
        *   If it doesn't exist, downloads "EXPECTED_SHA256_HASH_FOR_LH_PIAL"

schaefer400_2 the file from `url` (showing progress).
        *   Verifies downloaded file size and SHA256 hash.
        *   Saves the verified file to `test-data/refs/cache/{output_path}` (mm:
  description: "Schaefer 400 Parcel Atlas (2mm MNI)"
  url: "URL_TO_SCHAEFER_ATLAS_NII_GZ" # Needs stable URL fromcreating subdirectories as needed).
    *   Provides clear output on success, failure, or cache hits.
*   **Optional Rust Version:** `cargo xtask fetch-refs` could provide the same functionality for use in Rust-centric environments or CI.

##  Yeo Lab repo/other source
  sha256: "EXPECTED_SHA256_HASH_FOR_ATLAS"
```

## 5. Usage in Tests and Code

*   **Unit/Integration Tests (Rust):** Use relative paths from `CARGO_MANIFEST_DIR` to access files in `test-data/unit/` or `test-data/overlays/`. Use environment variables or dedicated test functions to locate reference datasets in `test-data/refs/cache/`.
    ```rust
    #[cfg(test)]
    mod tests {
        use std::path::PathBuf;

        // Helper to get the path to the unit test data directory
        fn unit_test_data_path(filename: &str) -> PathBuf {
            // Assumes test is run from within a crate 2 levels below workspace root (e.g., core/loaders/nifti)
            // Adjust the number of .join("..") if tests are run from different locations.
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../..") 
                .join("test-data/unit")
                .join(filename)
        }

        // Helper to get the path to a *fetched* reference dataset
        fn ref_test_data_path(key: &str) -> Option<PathBuf> {
            // NOTE: This is a placeholder. A robust implementation would:
            // 1. Parse test-data/refs/datasets.yaml (e.g., using serde_yaml).
            // 2. Cache the parsed manifest (e.g., using once_cell::sync::Lazy).
            // 3. Look up the 'output_path' for the given 'key'.
            // 4. Construct the full path within test-data/refs/cache/.
            // 5. Check if the constructed path exists and return Some(path) or None.
            let base_cache_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../..") // Adjust relative path as needed
                .join("test-data/refs/cache");

            // Placeholder lookup - REPLACE with manifest parsing logic
            let output_path = match key {
                 "ds000114_t1w" => Some("ds000114/sub-01/anat/sub-01_T1w.nii.gz"),
                 "ds000114_bold" => Some("ds000114/sub-01/func/sub-01_task-fingerfootlips_bold.nii.gz"),
                 // ... add other keys from datasets.yaml
                 _ => None,
            };

            output_path.and_then(|p| {
                let full_path = base_cache_dir.join(p);
                if full_path.exists() { Some(full_path) } else { None }
            })
        }

        #[test]
        fn test_with_unit_data() {
            let path = unit_test_data_path("toy_t1w.nii.gz");
            assert!(path.exists(), "Unit test data not found: {:?}", path);
            // ... use path in test ...
        }

         #[test]
         #[ignore] // Ignored by default because it requires external data & may be slow
         fn test_with_ref_data() {
             // This test requires 'pnpm run fetch:refs' to have been run previously.
             if let Some(path) = ref_test_data_path("ds000114_t1w") {
                 println!("Found reference data at: {}", path.display());
                 // ... run test requiring the large dataset ...
             } else {
                 panic!("Reference dataset 'ds000114_t1w' not found. Run 'pnpm run fetch:refs'.");
             }
         }
    }
    ```
*   **UI / E2E Tests (TypeScript/Playwright):** Use relative paths or build tool imports (`?url`) for `unit/` and `overlays/`. Reference datasets might require configuration or assumptions about local fetch script execution.
    ```typescript
    // Example using Vite import alias (configure in vite.config.ts)
    import toySurfaceUrl from '$testdata/unit/toy_surfaceoutput_path} based on the key.
            // Returns None if data not fetched.
            let base_cache_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../test-data/refs/cache");.gii?url'; // '?url' gives path/URL

    // Example direct path (less robust)
    const
            // Read datasets.yaml logic here... find output_path for key...
            let output_path = match overlayPath = '../../test-data/overlays/toy_zmap.nii.gz';

    async key {
                 "ds000114_t1w" => "ds000114/sub-01/anat/sub-01_T1w.nii.gz",
                 _ => function loadTestData() {
        // Check if reference data exists before trying to load it
        const refT1Path return None, // Placeholder
            };
            let full_path = base_cache_dir.join(output_path);
            if full_path.exists() { Some(full_path) } else { None }
        }

 = await coreApi.resolve_path('../test-data/refs/cache/ds000114        #[test]
        fn test_with_unit_data() {
            let path = unit_test_data_path("toy_t1w.nii.gz'); // Example API
        if (refT1Path) {
           await coreApi.load_file(refT1Path);
        } else {
           console.warn("_t1w.nii.gz");
            assert!(path.exists());
            // ... use pathReference T1w not found. Run 'pnpm run fetch:refs'.");
        }
    }
 in test ...
        }

         #[test]
         #[ignore] // Ignored by default, run explicitly for perf/QA
         fn test_with_ref_data() {
             if let Some(path) = ref    ```

## 6. CI Integration

*   Ensure the CI environment has Git LFS installed and configured (`_test_data_path("ds000114_t1w") {
                 // ... runactions/checkout@v4` often handles this).
*   The `fetch:refs` script should *not* run test requiring the large dataset ...
                 println!("Found reference data at: {}", path.display());
             } else {
                 panic!("Reference dataset 'ds000114_t1w' not found. Run 'pnpm run fetch:refs'.");
             }
         }
    }
    ```
*   **UI on standard CI jobs to save time/bandwidth.
*   A dedicated "Performance Benchmark" or "Manual QA" job matrix/E2E Tests (TypeScript/Playwright):** Use relative paths or build tool imports (`?url`) for ` entry in `ci.yml` can include a step to run `pnpm run fetch:refs` before executing performanceunit/` and `overlays/`. Reference datasets might require configuration or assumptions about local fetch script execution.
    ```typescript tests or specific E2E suites that require the reference datasets. This job can cache the downloaded `test-data/refs/cache/
    // Example in a Vitest/Svelte test
    import T1_UNIT_URL from '$root/test-data/` directory using `actions/cache` keyed on the `datasets.yaml` hash.

## 7. Actionunit/toy_t1w.nii.gz?url'; // Vite import asset URL

    // Example accessing Item (From Backlog)

*   **BF-00T:** Create `test-data` directory structure ref data path (assuming known location)
    const REF_T1_PATH = '../test-data/refs/cache/ds000114/sub-01/anat/sub-01_T1w, initialize Git LFS for `unit/` and `overlays/`, create initial `datasets.yaml` manifest.nii.gz';

    // Playwright might need to upload files or access them via absolute paths
    // depending (with placeholder URLs/hashes initially), implement the `fetch-refs.ts` script, and add the `fetch:refs` script to `package.json`. Add LFS configuration to `.gitattributes`. Update `.gitignore` for on test context (browser vs Node).
    ```

## 7. CI Integration

*   **Standard Jobs `refs/cache/`.

---