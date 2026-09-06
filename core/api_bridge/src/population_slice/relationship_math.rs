//! Exact bounded classical scaling on one common support. No pairwise deletion.
use super::{input, Distance, SampleCancellation};
use bridge_types::BridgeResult;
use nalgebra::{DMatrix, SymmetricEigen};

#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Merge {
    pub left: usize,
    pub right: usize,
    pub distance: f64,
    pub count: usize,
}
#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Geometry {
    pub coordinates: Vec<[f64; 2]>,
    pub distances: Vec<Vec<f64>>,
    pub eigenvalues: Vec<f64>,
    pub explained_fraction: f64,
    pub stress: f64,
    pub orderable: bool,
    pub merges: Vec<Merge>,
}
pub fn fit(
    rows: &[Vec<f32>],
    support: &[usize],
    metric: &Distance,
    token: &SampleCancellation,
) -> BridgeResult<Geometry> {
    let n = rows.len();
    let p = support.len();
    if n < 2 || p < 2 {
        return Err(input(
            "Similarity requires at least two observations and two common finite voxels.",
        ));
    }
    let mut means = vec![0.; n];
    let mut norms = vec![1.; n];
    if matches!(metric, Distance::PatternShape) {
        for (i, row) in rows.iter().enumerate() {
            let mut m2 = 0.;
            for (k, &v) in support.iter().enumerate() {
                if k % 4096 == 0 {
                    token.check()?;
                }
                let value = row[v] as f64;
                let delta = value - means[i];
                means[i] += delta / (k + 1) as f64;
                m2 += delta * (value - means[i]);
            }
            if m2 <= 0. || !m2.is_finite() {
                return Err(input(format!("Observation {} is constant on common support; pattern shape is undefined. Use effect distance or change the context/support.",i+1)));
            }
            norms[i] = m2.sqrt();
        }
    } else {
        norms.fill((p as f64).sqrt());
    }
    let mut gram = DMatrix::<f64>::zeros(n, n);
    for chunk in support.chunks(4096) {
        token.check()?;
        let mut block = DMatrix::zeros(n, chunk.len());
        for (j, &voxel) in chunk.iter().enumerate() {
            // Center across observations before Gram multiplication to avoid a
            // large common signal dominating small between-map differences.
            let reference = (rows[0][voxel] as f64 - means[0]) / norms[0];
            let delta = |i: usize| match metric {
                Distance::Effect => (rows[i][voxel] as f64 - rows[0][voxel] as f64) / norms[i],
                Distance::PatternShape => (rows[i][voxel] as f64 - means[i]) / norms[i] - reference,
            };
            let average_delta = (0..n).map(delta).sum::<f64>() / n as f64;
            for i in 0..n {
                block[(i, j)] = delta(i) - average_delta;
            }
        }
        gram += &block * block.transpose();
    }
    token.check()?;
    if !gram.iter().all(|v| v.is_finite()) {
        return Err(input("Similarity calculation overflowed."));
    }
    let distances: Vec<Vec<f64>> = (0..n)
        .map(|i| {
            (0..n)
                .map(|j| {
                    (gram[(i, i)] + gram[(j, j)] - 2. * gram[(i, j)])
                        .max(0.)
                        .sqrt()
                })
                .collect()
        })
        .collect();
    let scale = gram.amax();
    if scale > 0. {
        gram /= scale;
    }
    let eig = SymmetricEigen::try_new(gram, 1e-14, 100_000)
        .ok_or_else(|| input("Classical MDS did not converge."))?;
    token.check()?;
    let mut axes: Vec<_> = (0..n).collect();
    axes.sort_by(|&a, &b| {
        eig.eigenvalues[b]
            .total_cmp(&eig.eigenvalues[a])
            .then(a.cmp(&b))
    });
    let eigenvalues: Vec<_> = axes
        .iter()
        .map(|&i| (eig.eigenvalues[i] * scale).max(0.))
        .collect();
    let tolerance = eigenvalues[0] * 1e-10;
    let total: f64 = eigenvalues.iter().filter(|&&v| v > tolerance).sum();
    let mut coordinates = vec![[0.; 2]; n];
    for axis in 0..2 {
        if eigenvalues[axis] <= tolerance {
            continue;
        }
        let column = eig.eigenvectors.column(axes[axis]);
        let anchor = (0..n)
            .max_by(|&a, &b| column[a].abs().total_cmp(&column[b].abs()).then(b.cmp(&a)))
            .unwrap();
        let sign = if column[anchor] < 0. { -1. } else { 1. };
        for i in 0..n {
            coordinates[i][axis] = column[i] * eigenvalues[axis].sqrt() * sign;
        }
    }
    let mut residual = 0.;
    let mut squared = 0.;
    for i in 0..n {
        for j in 0..i {
            let projected = (coordinates[i][0] - coordinates[j][0])
                .hypot(coordinates[i][1] - coordinates[j][1]);
            residual += (distances[i][j] - projected).powi(2);
            squared += distances[i][j].powi(2);
        }
    }
    let merges = average_linkage(&distances, token)?;
    Ok(Geometry {
        coordinates,
        distances,
        explained_fraction: if total > 0. {
            (eigenvalues[0] + eigenvalues[1]) / total
        } else {
            1.
        },
        stress: if squared > 0. {
            (residual / squared).sqrt()
        } else {
            0.
        },
        orderable: total > 0. && eigenvalues[0] - eigenvalues[1] > eigenvalues[0] * 1e-8,
        eigenvalues,
        merges,
    })
}
/// Exact spatial explanation in the same transformed common-support space as MDS.
pub(super) fn explain(
    rows: &[Vec<f32>],
    support: &[usize],
    metric: &Distance,
    geometry: &Geometry,
    choice: &super::ExplanationKind,
    labels: &[String],
    token: &SampleCancellation,
) -> BridgeResult<(Vec<f64>, f64, String)> {
    let n = rows.len();
    let p = support.len();
    let mut means = vec![0.; n];
    let mut norms = vec![(p as f64).sqrt(); n];
    if matches!(metric, Distance::PatternShape) {
        for (i, row) in rows.iter().enumerate() {
            let mut m2 = 0.;
            for (k, &j) in support.iter().enumerate() {
                let x = row[j] as f64;
                let delta = x - means[i];
                means[i] += delta / (k + 1) as f64;
                m2 += delta * (x - means[i]);
            }
            if m2 <= 0. {
                return Err(input("Pattern shape is undefined for a constant map."));
            }
            norms[i] = m2.sqrt();
        }
    }
    let pair = match choice {
        super::ExplanationKind::Pair { a, b } => Some((
            labels
                .iter()
                .position(|id| id == a)
                .ok_or_else(|| input("Unknown first observation."))?,
            labels
                .iter()
                .position(|id| id == b)
                .ok_or_else(|| input("Unknown second observation."))?,
        )),
        _ => None,
    };
    let axis = match choice {
        super::ExplanationKind::Component { axis }
            if *axis < 2 && geometry.eigenvalues[*axis] > geometry.eigenvalues[0] * 1e-10 =>
        {
            Some(*axis)
        }
        super::ExplanationKind::Component { .. } => {
            return Err(input("Choose one of the first two nonzero components."))
        }
        _ => None,
    };
    let mut result = Vec::with_capacity(p);
    for (k, &j) in support.iter().enumerate() {
        if k % 4096 == 0 {
            token.check()?;
        }
        let transformed = |i: usize| (rows[i][j] as f64 - means[i]) / norms[i];
        let value = if let Some((a, b)) = pair {
            let d = if matches!(metric, Distance::Effect) {
                (rows[a][j] as f64 - rows[b][j] as f64) / norms[a]
            } else {
                transformed(a) - transformed(b)
            };
            d * d
        } else {
            let axis = axis.unwrap();
            let reference = transformed(0);
            let delta = |i: usize| {
                if matches!(metric, Distance::Effect) {
                    (rows[i][j] as f64 - rows[0][j] as f64) / norms[i]
                } else {
                    transformed(i) - reference
                }
            };
            let mean = (0..n).map(delta).sum::<f64>() / n as f64;
            (0..n)
                .map(|i| (delta(i) - mean) * geometry.coordinates[i][axis])
                .sum::<f64>()
                / geometry.eigenvalues[axis]
        };
        if !value.is_finite() {
            return Err(input("Spatial explanation overflowed."));
        }
        result.push(value);
    }
    let total = if pair.is_some() {
        result.iter().sum()
    } else {
        result.iter().map(|v| v * v).sum()
    };
    Ok((
        result,
        total,
        if pair.is_some() {
            "Squared distance contribution; sums over common support to squared distance".into()
        } else {
            "Unit-norm spatial loading in the fitted transformed space; observed maps remain original".into()
        },
    ))
}

fn average_linkage(distances: &[Vec<f64>], token: &SampleCancellation) -> BridgeResult<Vec<Merge>> {
    let n = distances.len();
    let size = 2 * n - 1;
    let mut d = vec![vec![0.; size]; size];
    for i in 0..n {
        d[i][..n].copy_from_slice(&distances[i]);
    }
    let mut counts = vec![0; size];
    counts[..n].fill(1);
    let mut active: Vec<usize> = (0..n).collect();
    let mut merges = Vec::new();
    while active.len() > 1 {
        token.check()?;
        let mut best = (f64::INFINITY, 0, 0);
        for (a, &i) in active.iter().enumerate() {
            for &j in active.iter().skip(a + 1) {
                let candidate = (d[i][j], i, j);
                if candidate < best {
                    best = candidate;
                }
            }
        }
        let (distance, i, j) = best;
        let next = n + merges.len();
        counts[next] = counts[i] + counts[j];
        for &k in &active {
            d[next][k] =
                (d[i][k] * counts[i] as f64 + d[j][k] * counts[j] as f64) / counts[next] as f64;
            d[k][next] = d[next][k];
        }
        merges.push(Merge {
            left: i,
            right: j,
            distance,
            count: counts[next],
        });
        active.retain(|&k| k != i && k != j);
        active.push(next);
    }
    Ok(merges)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn run(rows: &[Vec<f32>], metric: Distance) -> Geometry {
        fit(
            rows,
            &(0..rows[0].len()).collect::<Vec<_>>(),
            &metric,
            &SampleCancellation::default(),
        )
        .unwrap()
    }
    #[test]
    fn distances_match_direct_oracle_and_scale_in_both_tails() {
        for scale in [1e-30_f32, 1., 1e30] {
            let rows: Vec<Vec<f32>> = (0..5)
                .map(|i| {
                    (0..11)
                        .map(|j| ((i * j + 3 * i + j * j) % 17) as f32 * scale)
                        .collect()
                })
                .collect();
            let g = run(&rows, Distance::Effect);
            for i in 0..5 {
                for j in 0..5 {
                    let exact = (rows[i]
                        .iter()
                        .zip(&rows[j])
                        .map(|(&a, &b)| (a as f64 - b as f64).powi(2))
                        .sum::<f64>()
                        / 11.)
                        .sqrt();
                    assert!(
                        (g.distances[i][j] - exact).abs() <= exact * 1e-12 + scale as f64 * 1e-12
                    );
                }
            }
            assert!(g.stress.is_finite());
            assert!(g.explained_fraction > 0. && g.explained_fraction <= 1. + 1e-12);
            let normalized: Vec<_> = rows
                .iter()
                .map(|row| row.iter().map(|&v| v / scale).collect())
                .collect();
            let reference = run(&normalized, Distance::Effect);
            assert!((g.stress - reference.stress).abs() < 1e-7);
        }
    }
    #[test]
    fn analytic_line_and_large_shared_offset() {
        for offset in [0., 16_777_216.] {
            let rows: Vec<_> = [0., 2., 8.].iter().map(|v| vec![offset + v; 3]).collect();
            let g = run(&rows, Distance::Effect);
            assert!((g.distances[0][2] - 8.).abs() < 1e-10);
            assert!(g.stress < 1e-12);
            assert!(g.orderable);
            assert_eq!((g.merges[0].left, g.merges[0].right), (0, 1));
            assert!((g.merges[1].distance - 7.).abs() < 1e-10);
        }
    }
    #[test]
    fn square_has_exact_two_dimensional_geometry_but_no_unique_first_axis() {
        let g = run(
            &[vec![0., 0.], vec![2., 0.], vec![0., 2.], vec![2., 2.]],
            Distance::Effect,
        );
        assert!((g.distances[0][3] - 2.).abs() < 1e-12);
        assert!(g.stress < 1e-12);
        assert!(!g.orderable);
        assert!((g.explained_fraction - 1.).abs() < 1e-12);
    }
    #[test]
    fn shape_removes_offset_and_positive_scale_but_preserves_opposition() {
        let g = run(
            &[vec![0., 1., 2.], vec![10., 12., 14.], vec![2., 1., 0.]],
            Distance::PatternShape,
        );
        assert!(g.distances[0][1] < 1e-7);
        assert!((g.distances[0][2] - 2.).abs() < 1e-12);
        assert!(fit(
            &[vec![1.; 3], vec![0., 1., 2.]],
            &[0, 1, 2],
            &Distance::PatternShape,
            &SampleCancellation::default()
        )
        .is_err());
    }
    #[test]
    fn permutation_preserves_distances_and_zero_variation_is_unorderable() {
        let rows = vec![vec![1., 2., 4.], vec![2., 3., 8.], vec![5., 0., 2.]];
        let a = run(&rows, Distance::Effect);
        let b = run(
            &[rows[2].clone(), rows[0].clone(), rows[1].clone()],
            Distance::Effect,
        );
        assert!((a.distances[0][2] - b.distances[1][0]).abs() < 1e-12);
        let g = run(&[vec![1.; 3], vec![1.; 3]], Distance::Effect);
        assert!(!g.orderable);
        assert_eq!(g.stress, 0.);
    }
}

#[cfg(test)]
mod explanation_tests {
    use super::*;
    #[test]
    fn contribution_sums_and_loading_normalization_match_geometry() {
        let rows = vec![vec![1., 2., 4.], vec![2., 1., 6.], vec![4., 5., 0.]];
        let labels = vec!["A".into(), "B".into(), "C".into()];
        for metric in [Distance::Effect, Distance::PatternShape] {
            let token = SampleCancellation::default();
            let g = fit(&rows, &[0, 1, 2], &metric, &token).unwrap();
            let (v, total, _) = explain(
                &rows,
                &[0, 1, 2],
                &metric,
                &g,
                &super::super::ExplanationKind::Pair {
                    a: "A".into(),
                    b: "B".into(),
                },
                &labels,
                &token,
            )
            .unwrap();
            assert!(v.iter().all(|&v| v >= 0.));
            assert!((total - g.distances[0][1].powi(2)).abs() < 1e-10);
            if matches!(metric, Distance::Effect) {
                assert!((v[2] - 4. / 3.).abs() < 1e-12);
            }
            for axis in 0..2 {
                let (_, norm, _) = explain(
                    &rows,
                    &[0, 1, 2],
                    &metric,
                    &g,
                    &super::super::ExplanationKind::Component { axis },
                    &labels,
                    &token,
                )
                .unwrap();
                assert!((norm - 1.).abs() < 1e-10);
            }
        }
    }
}
