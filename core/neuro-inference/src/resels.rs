//! Resel counts of a search volume on a voxel lattice.
//!
//! Points, edges, faces and cubes of the mask are counted as SPM's
//! `spm_resels_vol` does (Worsley et al. 1996, Hum Brain Mapp 4:58-73, eq. 7
//! and Table 2). `R0` is the Euler characteristic of the mask; `R1..R3` scale
//! with voxel size in FWHM units.

/// Resel counts `[R0, R1, R2, R3]` of a binary search mask on a lattice with
/// voxel sizes `voxel_fwhm` given in FWHM units (voxel size / FWHM per axis),
/// counting points, edges, faces and cubes as `spm_resels_vol` does. For an
/// `a × b × c` box (in FWHM units, voxel-centre extents) this gives
/// `[1, a+b+c, ab+bc+ca, abc]`.
pub fn lattice_resels(mask: &[bool], dims: [usize; 3], voxel_fwhm: [f64; 3]) -> [f64; 4] {
    let [nx, ny, nz] = dims;
    let at = |i: usize, j: usize, k: usize| -> bool {
        i < nx && j < ny && k < nz && mask[i + nx * (j + ny * k)]
    };
    let (mut p, mut ex, mut ey, mut ez) = (0u64, 0u64, 0u64, 0u64);
    let (mut fxy, mut fxz, mut fyz, mut cubes) = (0u64, 0u64, 0u64, 0u64);
    for k in 0..nz {
        for j in 0..ny {
            for i in 0..nx {
                if !at(i, j, k) {
                    continue;
                }
                p += 1;
                let x = at(i + 1, j, k);
                let y = at(i, j + 1, k);
                let z = at(i, j, k + 1);
                let xy = x && y && at(i + 1, j + 1, k);
                let xz = x && z && at(i + 1, j, k + 1);
                let yz = y && z && at(i, j + 1, k + 1);
                ex += u64::from(x);
                ey += u64::from(y);
                ez += u64::from(z);
                fxy += u64::from(xy);
                fxz += u64::from(xz);
                fyz += u64::from(yz);
                cubes += u64::from(xy && xz && yz && at(i + 1, j + 1, k + 1));
            }
        }
    }
    let [rx, ry, rz] = voxel_fwhm;
    let f = |n: u64| n as f64;
    let c = f(cubes);
    [
        f(p) - (f(ex) + f(ey) + f(ez)) + (f(fxy) + f(fxz) + f(fyz)) - c,
        (f(ex) - f(fxy) - f(fxz) + c) * rx
            + (f(ey) - f(fxy) - f(fyz) + c) * ry
            + (f(ez) - f(fxz) - f(fyz) + c) * rz,
        (f(fxy) - c) * rx * ry + (f(fxz) - c) * rx * rz + (f(fyz) - c) * ry * rz,
        c * rx * ry * rz,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(actual: f64, expected: f64, rel: f64) {
        let err = (actual - expected).abs() / expected.abs().max(1e-300);
        assert!(
            err <= rel,
            "actual {actual:e} vs expected {expected:e} (rel err {err:e})"
        );
    }

    #[test]
    fn box_resels_match_worsley_closed_form() {
        // 10 x 6 x 4 voxels of 2 mm with 4 mm FWHM: voxel size 0.5 FWHM.
        // Voxel-centre extents a, b, c = (n - 1) * 0.5 = 4.5, 2.5, 1.5.
        let dims = [10, 6, 4];
        let mask = vec![true; 240];
        let r = lattice_resels(&mask, dims, [0.5; 3]);
        let (a, b, c) = (4.5, 2.5, 1.5);
        let expected = [1.0, a + b + c, a * b + b * c + c * a, a * b * c];
        for (got, want) in r.iter().zip(expected) {
            close(*got, want, 1e-12);
        }
        // Anisotropic voxels scale each axis separately.
        let r = lattice_resels(&mask, dims, [0.5, 1.0, 0.25]);
        let (a, b, c) = (4.5, 5.0, 0.75);
        close(r[1], a + b + c, 1e-12);
        close(r[2], a * b + b * c + c * a, 1e-12);
        close(r[3], a * b * c, 1e-12);
    }

    #[test]
    fn hollow_and_split_masks_have_expected_euler_characteristic() {
        // Two separate boxes: R0 = 2.
        let dims = [9, 3, 3];
        let mut mask = vec![true; 81];
        for k in 0..3 {
            for j in 0..3 {
                mask[4 + 9 * (j + 3 * k)] = false;
            }
        }
        close(lattice_resels(&mask, dims, [1.0; 3])[0], 2.0, 1e-12);
        // A 3x3x3 shell with a hollow centre: sphere-like, R0 = 2.
        let mut shell = vec![true; 27];
        shell[13] = false;
        close(lattice_resels(&shell, [3, 3, 3], [1.0; 3])[0], 2.0, 1e-12);
    }
}
