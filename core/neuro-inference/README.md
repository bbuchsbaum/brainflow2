# neuro-inference

Statistical inference for thresholded neuroimaging maps, in plain Rust.
Dependencies: `libm`, plus `serde` behind the optional `serde` feature.

## Model

A statistic image is described by `StatField`:

- the field type (`FieldKind::Z`, `T { df }` or `F { df1, df2 }`);
- the 3D grid (`dims`, x-fastest order) and the voxel size in mm per voxel axis;
- a boolean search mask (the voxels that count toward the multiple-comparison
  family).

Methods take a field and return p values with the assumptions they rest on.

### Cluster level: `ClusterInference`

```rust
use neuro_inference::*;

let field = StatField::new(FieldKind::T { df: 24.0 }, dims, voxel_mm, &mask)?;
let method = RftClusterExtent::new(Smoothness::isotropic_fwhm_mm(8.0));
let result = method.infer(&field, &[ClusterExtent::new(120)], &ClusterSearch::one_tailed(3.1))?;
// result.clusters[0].p_corrected, result.summary.assumptions, result.summary.diagnostics
```

Methods have stable string ids (`ClusterMethodId`): `"rft-extent"` is
implemented. `"permutation-max-cluster"`, `"tfce"` and `"cluster-mass"` are
reserved. They need subject-level data (a permutation or sign-flip null) that
a single statistic image lacks.

### Voxel level: `VoxelThreshold`

`Bonferroni` (`"bonferroni"`) and `BenjaminiHochberg` (`"fdr-bh"`) adjust a
family of uncorrected p values, matching R's `p.adjust`. `"rft-peak"`
(random-field peak-height FWE) is reserved.

## Random field cluster extent (`"rft-extent"`)

This is a port of SPM12's `spm_P_RF.m` and `spm_ECdensity` for 3D fields and a
single component SPM. Resel counts follow SPM's `spm_resels_vol`.

1. Resels `[R0, R1, R2, R3]` of the search mask are counted on the lattice:
   points, edges, faces and 2×2×2 cubes, scaled by voxel size / FWHM per axis
   (Worsley et al. 1996, eq. 7). Alternatively the caller supplies them.
2. Euler characteristic densities `EC_0..EC_3` at the cluster-forming threshold
   `u` are computed for the Z, T and F fields. t and F fields use their own
   densities, not a z conversion.
3. The expected number of clusters is `Ec = Σ R_d EC_d(u)`. The expected resels
   per cluster is `Ek = EC_0 / EC_3`.
4. For a cluster of `k` resels (voxels × resels per voxel),
   `p(n ≥ k) = exp(-β k^(2/3))` with `β = (Γ(5/2) / Ek)^(2/3)`. This is the
   uncorrected extent p.
5. The FWE-corrected p is `1 - exp(-(Ec + eps) p(n ≥ k))` (Poisson clumping).
6. Tails: `ClusterSearch` says whether one sign or both signs (Z and T fields)
   were searched. With two tails the family-wise p is `1 - (1 - P)^2` over the
   tails (Šidák; `familywise_over_tails`), which here equals doubling `Ec`.
   The uncorrected `p(n ≥ k)` stays per cluster, and `Ec` is reported per tail.
   F fields are one-tailed. Every cluster method follows this convention.

### Assumptions

- Smoothness is stationary and known. It is supplied by the user, never
  estimated from the statistic map.
- The cluster-forming threshold is high (e.g. z ≥ 3.1), so excursions are
  well approximated by the Gaussian-form cluster-size distribution.
- The field is smooth relative to the voxel size. Below about 3 voxels FWHM
  the lattice departs from the continuous theory: p values become
  conservative and unstable. The method then adds a caveat to its
  assumptions.

### References

- Friston KJ, Worsley KJ, Frackowiak RSJ, Mazziotta JC, Evans AC (1994).
  Assessing the significance of focal activations using their spatial extent.
  *Human Brain Mapping* 1:210–220.
- Worsley KJ, Marrett S, Neelin P, Vandal AC, Friston KJ, Evans AC (1996).
  A unified statistical approach for determining significant signals in images
  of cerebral activation. *Human Brain Mapping* 4:58–73.
- SPM12 source: `spm_P_RF.m`, `spm_ECdensity.m`, `spm_resels_vol.c`
  (https://github.com/spm/spm12).
- Benjamini Y, Hochberg Y (1995). Controlling the false discovery rate.
  *JRSS B* 57:289–300.

### Validation

- **Resels:** for an `a × b × c` box (in FWHM units, voxel-centre extents), the
  counts equal Worsley's closed form `[1, a+b+c, ab+bc+ca, abc]`, isotropic and
  anisotropic. The Euler characteristic is 2 for two disjoint boxes and for a
  hollow shell.
- **Formulas:** `tests/fixtures/rft_reference.py` is an independent
  numpy/scipy implementation of the same SPM formulas, with scipy.stats tails.
  The crate agrees to a relative error of 1e-9 on Z, T and F cases (`P`, `p`,
  `Ec`, `Ek`), and its normal, t and F tails agree to 1e-10. SPM itself was not
  executed for these tests.
- **Monte Carlo** (`python3 rft_reference.py --simulate`): smoothed Gaussian
  fields at 72³, 150 realisations.

  | FWHM | u | simulated mean clusters | theory Ec | simulated resels/cluster | theory Ek |
  |---|---|---|---|---|---|
  | 6 voxels | 3.0 | 18.7 | 19.8 | 0.120 | 0.130 |
  | 8 voxels | 3.0 | 8.4 | 8.7 | 0.116 | 0.130 |
  | 6 voxels | 3.5 | 4.9 | 5.4 | 0.072 | 0.081 |
  | 4 voxels | 3.0 | 38.0 | 45.1 | 0.143 | 0.130 |

  The theory is slightly conservative on a lattice (5–12%) at 6–8 voxels FWHM
  and about 19% over at 4 voxels, as expected.
- **FDR / Bonferroni:** these match R 4 `p.adjust(p, "BH")` and
  `p.adjust(p, "bonferroni")`.

## Adding a method

1. Implement `ClusterInference` (or `VoxelThreshold`) for a config struct.
   Return assumptions in `MethodSummary.assumptions` and method-specific
   numbers in a new `Diagnostics` variant.
2. Add a stable id to `ClusterMethodId` (or `VoxelMethodId`), and a variant to
   `ClusterMethod` for dispatch.
3. Add reference tests against an independent implementation, and document the
   assumptions here.

Run the tests with `cargo test -p neuro-inference`.
