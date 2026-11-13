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
    /// Up to eight positive axes; the first two retain the plotted geometry.
    #[serde(default)]
    pub component_scores: Vec<Vec<f64>>,
    pub distances: Vec<Vec<f64>>,
    pub eigenvalues: Vec<f64>,
    pub explained_fraction: f64,
    pub stress: f64,
    pub orderable: bool,
    /// v1/v2: average linkage. v3: the requested linkage.
    pub merges: Vec<Merge>,
    /// v3 only: silhouette-scored cuts of `merges`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grouping: Option<GroupingSummary>,
}
/// The v1/v2 geometry (production calls `fit_with`; tests use this form).
#[cfg(test)]
pub fn fit(
    rows: &[Vec<f32>],
    support: &[usize],
    metric: &Distance,
    token: &SampleCancellation,
) -> BridgeResult<Geometry> {
    fit_with(rows, support, metric, None, token)
}
/// `grouping`: None keeps the v1/v2 geometry exactly (average linkage, no
/// grouping summary); Some(linkage) builds merges with it and scores cuts.
pub fn fit_with(
    rows: &[Vec<f32>],
    support: &[usize],
    metric: &Distance,
    grouping: Option<Linkage>,
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
    let gram_started = std::time::Instant::now();
    let mut gram = DMatrix::<f64>::zeros(n, n);
    for chunk in support.chunks(4096) {
        token.check()?;
        let mut block = DMatrix::zeros(n, chunk.len());
        for (j, &voxel) in chunk.iter().enumerate() {
            // Center across observations before Gram multiplication to avoid a
            // large common signal dominating small between-map differences.
            let reference = (rows[0][voxel] as f64 - means[0]) / norms[0];
            let mut column = block.column_mut(j);
            // Each delta is computed once and summed in observation order:
            // the same values and the same sum as evaluating it twice.
            match metric {
                Distance::Effect => {
                    let first = rows[0][voxel] as f64;
                    for i in 0..n {
                        column[i] = (rows[i][voxel] as f64 - first) / norms[i];
                    }
                }
                Distance::PatternShape => {
                    for i in 0..n {
                        column[i] = (rows[i][voxel] as f64 - means[i]) / norms[i] - reference;
                    }
                }
            }
            let average_delta = column.iter().copied().sum::<f64>() / n as f64;
            for value in column.iter_mut() {
                *value -= average_delta;
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
    log::info!(
        "[perf] similarity gram: {n} members x {p} voxels, {} ms",
        gram_started.elapsed().as_millis()
    );
    let scale = gram.amax();
    if scale > 0. {
        gram /= scale;
    }
    let eigen_started = std::time::Instant::now();
    let eig = SymmetricEigen::try_new(gram, 1e-14, 100_000)
        .ok_or_else(|| input("Classical MDS did not converge."))?;
    log::info!(
        "[perf] similarity eigen: {n} x {n}, {} ms",
        eigen_started.elapsed().as_millis()
    );
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
    let rank = eigenvalues
        .iter()
        .take(8)
        .take_while(|&&v| v > tolerance)
        .count();
    let mut component_scores = vec![vec![0.; rank]; n];
    let mut coordinates = vec![[0.; 2]; n];
    for axis in 0..rank {
        if eigenvalues[axis] <= tolerance {
            continue;
        }
        let column = eig.eigenvectors.column(axes[axis]);
        let anchor = (0..n)
            .max_by(|&a, &b| column[a].abs().total_cmp(&column[b].abs()).then(b.cmp(&a)))
            .unwrap();
        let sign = if column[anchor] < 0. { -1. } else { 1. };
        for i in 0..n {
            component_scores[i][axis] = column[i] * eigenvalues[axis].sqrt() * sign;
            if axis < 2 {
                coordinates[i][axis] = component_scores[i][axis];
            }
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
    let linkage_started = std::time::Instant::now();
    let merges = linkage_merges(&distances, grouping.unwrap_or(Linkage::Average), token)?;
    let grouping = grouping.map(|linkage| grouping_summary(&distances, &merges, linkage));
    log::info!(
        "[perf] similarity linkage and grouping: {n} members, {} ms",
        linkage_started.elapsed().as_millis()
    );
    Ok(Geometry {
        coordinates,
        component_scores,
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
        grouping,
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
            if *axis < geometry.component_scores[0].len()
                && geometry.eigenvalues[*axis] > geometry.eigenvalues[0] * 1e-10 =>
        {
            Some(*axis)
        }
        super::ExplanationKind::Component { .. } => {
            return Err(input(
                "Choose an available nonzero component (up to eight).",
            ))
        }
        _ => None,
    };
    let reconstruction = match choice {
        super::ExplanationKind::Reconstruction { member, components } => {
            let i = labels
                .iter()
                .position(|id| id == member)
                .ok_or_else(|| input("Unknown reconstruction observation."))?;
            if *components > geometry.component_scores[0].len() {
                return Err(input("Reconstruction requests unavailable components."));
            }
            Some((i, *components))
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
            let reference = transformed(0);
            let delta = |i: usize| {
                if matches!(metric, Distance::Effect) {
                    (rows[i][j] as f64 - rows[0][j] as f64) / norms[i]
                } else {
                    transformed(i) - reference
                }
            };
            let mean = (0..n).map(delta).sum::<f64>() / n as f64;
            let loading = |axis: usize| {
                (0..n)
                    .map(|i| (delta(i) - mean) * geometry.component_scores[i][axis])
                    .sum::<f64>()
                    / geometry.eigenvalues[axis]
            };
            if let Some((i, count)) = reconstruction {
                let value = reference
                    + mean
                    + (0..count)
                        .map(|axis| geometry.component_scores[i][axis] * loading(axis))
                        .sum::<f64>();
                if matches!(metric, Distance::Effect) {
                    value * (p as f64).sqrt()
                } else {
                    value
                }
            } else {
                loading(axis.unwrap())
            }
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
        } else if let Some((_, count)) = reconstruction {
            format!("Reconstruction using {count} components plus the population center; {}; not an observed map",
                if matches!(metric, Distance::Effect) { "original effect units" } else { "centered, normalized pattern units" })
        } else {
            "Unit-norm spatial loading in the fitted transformed space; observed maps remain original".into()
        },
    ))
}

/// Agglomerative linkage for a v3 grouping fit.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Linkage {
    /// Ward's minimum-variance criterion (Lance–Williams on squared distances).
    #[default]
    Ward,
    /// Unweighted average linkage (UPGMA), as v1/v2 fits use.
    Average,
}
/// Average silhouette below this is reported as no clear grouping. Kaufman and
/// Rousseeuw (1990) read an average silhouette of 0.25 or less as "no
/// substantial structure"; only above it is a grouping reported as clear.
pub const CLEAR_GROUPING_SILHOUETTE: f64 = 0.25;
/// Largest group count scored. Beyond eight, groups of a 35-member set are
/// mostly pairs and singletons and the silhouette stops being informative.
pub const MAX_SCORED_GROUPS: usize = 8;
/// One cut of the dendrogram into `groups` clusters.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupingCut {
    pub groups: usize,
    /// Mean silhouette over every fitted member; a singleton scores 0.
    pub silhouette: f64,
    /// Group index (0-based, ordered by first fitted member) per fitted member.
    pub assignment: Vec<usize>,
    /// Fitted members alone in their group: outliers, not groups.
    pub singletons: Vec<usize>,
}
/// Grouping summary for a v3 fit. Indices follow the fitted member order.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupingSummary {
    pub linkage: Linkage,
    /// Cuts for 2..=min(8, n - 1) groups, in increasing group count.
    pub cuts: Vec<GroupingCut>,
    /// Group count with the highest silhouette (smallest on ties); absent when
    /// no cut can be scored (fewer than three fitted members).
    pub best_groups: Option<usize>,
    /// True only when the best silhouette is above `silhouetteThreshold`.
    pub clear_grouping: bool,
    pub silhouette_threshold: f64,
}
/// Merges under `linkage`. Average is the v1/v2 routine unchanged.
pub fn linkage_merges(
    distances: &[Vec<f64>],
    linkage: Linkage,
    token: &SampleCancellation,
) -> BridgeResult<Vec<Merge>> {
    match linkage {
        Linkage::Average => average_linkage(distances, token),
        Linkage::Ward => ward_linkage(distances, token),
    }
}
/// Ward's criterion via the Lance–Williams recurrence on squared distances:
/// d²(k, i∪j) = [(nᵢ+nₖ)d²(k,i) + (nⱼ+nₖ)d²(k,j) − nₖd²(i,j)] / (nᵢ+nⱼ+nₖ).
/// Valid because the fit's distances are Euclidean between rows of the
/// transformed matrix (sqrt(Gᵢᵢ + Gⱼⱼ − 2Gᵢⱼ) with G = BBᵀ). The merge height
/// is the square root, so for two singletons it is their distance (as SciPy's
/// `ward`). The closest pair is found as in average linkage: lowest value,
/// then lowest indices, so ties resolve identically and deterministically.
fn ward_linkage(distances: &[Vec<f64>], token: &SampleCancellation) -> BridgeResult<Vec<Merge>> {
    let n = distances.len();
    let size = 2 * n - 1;
    let mut d = vec![vec![0.; size]; size];
    for i in 0..n {
        for j in 0..n {
            d[i][j] = distances[i][j] * distances[i][j];
        }
    }
    let mut counts = vec![0usize; size];
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
        if !best.0.is_finite() {
            return Err(input(
                "Similarity distances are not finite; grouping is undefined.",
            ));
        }
        let (squared, i, j) = best;
        let next = n + merges.len();
        counts[next] = counts[i] + counts[j];
        for &k in &active {
            if k == i || k == j {
                continue;
            }
            let (ni, nj, nk) = (counts[i] as f64, counts[j] as f64, counts[k] as f64);
            let value = ((ni + nk) * d[i][k] + (nj + nk) * d[j][k] - nk * squared) / (ni + nj + nk);
            d[next][k] = value;
            d[k][next] = value;
        }
        merges.push(Merge {
            left: i,
            right: j,
            distance: squared.max(0.).sqrt(),
            count: counts[next],
        });
        active.retain(|&k| k != i && k != j);
        active.push(next);
    }
    Ok(merges)
}
/// Group per member after the first `n - groups` merges, numbered by first member.
pub fn cut_assignment(merges: &[Merge], n: usize, groups: usize) -> Vec<usize> {
    let mut members: Vec<Option<Vec<usize>>> = (0..n).map(|i| Some(vec![i])).collect();
    members.resize(2 * n - 1, None);
    for (step, merge) in merges.iter().take(n - groups).enumerate() {
        let mut joined = members[merge.left].take().unwrap_or_default();
        joined.extend(members[merge.right].take().unwrap_or_default());
        members[n + step] = Some(joined);
    }
    let mut clusters: Vec<Vec<usize>> = members.into_iter().flatten().collect();
    clusters.sort_by_key(|c| c.iter().copied().min());
    let mut assignment = vec![0; n];
    for (group, cluster) in clusters.iter().enumerate() {
        for &i in cluster {
            assignment[i] = group;
        }
    }
    assignment
}
/// Mean silhouette (Rousseeuw 1987) over all members: s = (b − a) / max(a, b)
/// with a the mean distance to the member's own group and b the smallest mean
/// distance to another group; a member alone in its group scores 0, and so
/// does a member with a = b = 0.
pub fn mean_silhouette(distances: &[Vec<f64>], assignment: &[usize], groups: usize) -> f64 {
    let n = distances.len();
    let mut sizes = vec![0usize; groups];
    for &g in assignment {
        sizes[g] += 1;
    }
    let mut total = 0.;
    for i in 0..n {
        let own = assignment[i];
        if sizes[own] < 2 {
            continue;
        }
        let mut sums = vec![0.; groups];
        for j in 0..n {
            if j != i {
                sums[assignment[j]] += distances[i][j];
            }
        }
        let a = sums[own] / (sizes[own] - 1) as f64;
        let b = (0..groups)
            .filter(|&g| g != own)
            .map(|g| sums[g] / sizes[g] as f64)
            .fold(f64::INFINITY, f64::min);
        let scale = a.max(b);
        if scale > 0. {
            total += (b - a) / scale;
        }
    }
    total / n as f64
}
/// Silhouette-scored cuts for 2..=min(8, n − 1) groups.
pub fn grouping_summary(
    distances: &[Vec<f64>],
    merges: &[Merge],
    linkage: Linkage,
) -> GroupingSummary {
    let n = distances.len();
    let cuts: Vec<GroupingCut> = (2..=MAX_SCORED_GROUPS.min(n.saturating_sub(1)))
        .map(|groups| {
            let assignment = cut_assignment(merges, n, groups);
            let mut sizes = vec![0usize; groups];
            for &g in &assignment {
                sizes[g] += 1;
            }
            GroupingCut {
                groups,
                silhouette: mean_silhouette(distances, &assignment, groups),
                singletons: (0..n).filter(|&i| sizes[assignment[i]] == 1).collect(),
                assignment,
            }
        })
        .collect();
    let best = cuts
        .iter()
        .fold(None::<&GroupingCut>, |best, cut| match best {
            Some(b) if b.silhouette >= cut.silhouette => Some(b),
            _ => Some(cut),
        });
    GroupingSummary {
        linkage,
        best_groups: best.map(|c| c.groups),
        clear_grouping: best.is_some_and(|c| c.silhouette > CLEAR_GROUPING_SILHOUETTE),
        silhouette_threshold: CLEAR_GROUPING_SILHOUETTE,
        cuts,
    }
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
        if !best.0.is_finite() {
            return Err(input(
                "Similarity distances are not finite; grouping is undefined.",
            ));
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
    fn all_positive_components_reconstruct_originals_and_partial_error_decreases() {
        let rows = vec![
            vec![10., 2., 3., 1.],
            vec![11., 5., 0., 2.],
            vec![8., 3., 7., 4.],
            vec![9., 0., 4., 8.],
        ];
        let labels: Vec<String> = (0..4).map(|i| i.to_string()).collect();
        let support = vec![0, 1, 2, 3];
        let token = SampleCancellation::default();
        for metric in [Distance::Effect, Distance::PatternShape] {
            let g = fit(&rows, &support, &metric, &token).unwrap();
            let rank = g.component_scores[0].len();
            assert_eq!(rank, 3);
            for (i, row) in rows.iter().enumerate() {
                let mean = row.iter().map(|&x| x as f64).sum::<f64>() / 4.;
                let norm = row
                    .iter()
                    .map(|&x| (x as f64 - mean).powi(2))
                    .sum::<f64>()
                    .sqrt();
                let expected: Vec<f64> = row
                    .iter()
                    .map(|&x| {
                        if matches!(metric, Distance::Effect) {
                            x as f64
                        } else {
                            (x as f64 - mean) / norm
                        }
                    })
                    .collect();
                let mut previous = f64::INFINITY;
                for components in 0..=rank {
                    let (reconstructed, _, label) = explain(
                        &rows,
                        &support,
                        &metric,
                        &g,
                        &super::super::ExplanationKind::Reconstruction {
                            member: labels[i].clone(),
                            components,
                        },
                        &labels,
                        &token,
                    )
                    .unwrap();
                    let error = reconstructed
                        .iter()
                        .zip(&expected)
                        .map(|(a, b)| (a - b).powi(2))
                        .sum::<f64>();
                    assert!(error <= previous + 1e-10);
                    if components == rank {
                        assert!(error < 1e-20, "{error}");
                    }
                    assert!(label.contains("not an observed map"));
                    previous = error;
                }
            }
            let (_, norm, _) = explain(
                &rows,
                &support,
                &metric,
                &g,
                &super::super::ExplanationKind::Component { axis: 2 },
                &labels,
                &token,
            )
            .unwrap();
            assert!((norm - 1.).abs() < 1e-10);
            assert!(explain(
                &rows,
                &support,
                &metric,
                &g,
                &super::super::ExplanationKind::Reconstruction {
                    member: labels[0].clone(),
                    components: 9
                },
                &labels,
                &token
            )
            .is_err());
        }
    }
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

#[cfg(test)]
mod grouping_tests {
    use super::*;
    fn line(points: &[f64]) -> Vec<Vec<f64>> {
        points
            .iter()
            .map(|a| points.iter().map(|b| (a - b).abs()).collect())
            .collect()
    }
    fn token() -> SampleCancellation {
        SampleCancellation::default()
    }
    #[test]
    fn ward_heights_match_the_variance_criterion_by_hand() {
        // {0,1} merge at 1; {0,1}+{5}: ΔESS = (2·1/3)·4.5² = 13.5, height sqrt(2·13.5).
        let merges = linkage_merges(&line(&[0., 1., 5.]), Linkage::Ward, &token()).unwrap();
        assert_eq!(
            (merges[0].left, merges[0].right, merges[0].count),
            (0, 1, 2)
        );
        assert!((merges[0].distance - 1.).abs() < 1e-12);
        assert_eq!(
            (merges[1].left, merges[1].right, merges[1].count),
            (2, 3, 3)
        );
        assert!((merges[1].distance - 27f64.sqrt()).abs() < 1e-12);
        // Two tight pairs: ties resolve by index; centroids 0.5 and 10.5 give
        // ΔESS = (2·2/4)·10² = 100, height sqrt(200). Average linkage gives 10 (mean of 10, 11, 9, 10).
        let d = line(&[0., 1., 10., 11.]);
        let ward = linkage_merges(&d, Linkage::Ward, &token()).unwrap();
        let pairs: Vec<_> = ward.iter().map(|m| (m.left, m.right)).collect();
        assert_eq!(pairs, vec![(0, 1), (2, 3), (4, 5)]);
        assert!((ward[2].distance - 200f64.sqrt()).abs() < 1e-12);
        let average = linkage_merges(&d, Linkage::Average, &token()).unwrap();
        assert!((average[2].distance - 10.).abs() < 1e-12);
        assert_eq!(
            average
                .iter()
                .map(|m| (m.left, m.right, m.count))
                .collect::<Vec<_>>(),
            average_linkage(&d, &token())
                .unwrap()
                .iter()
                .map(|m| (m.left, m.right, m.count))
                .collect::<Vec<_>>()
        );
    }
    #[test]
    fn silhouettes_singletons_and_best_cut_by_hand() {
        let d = line(&[0., 1., 10., 11.]);
        let merges = linkage_merges(&d, Linkage::Ward, &token()).unwrap();
        let summary = grouping_summary(&d, &merges, Linkage::Ward);
        assert_eq!(summary.cuts.len(), 2); // 2..=min(8, n-1) = 2..=3
        let two = &summary.cuts[0];
        assert_eq!(two.assignment, vec![0, 0, 1, 1]);
        assert!(two.singletons.is_empty());
        // s(0) = (10.5-1)/10.5, s(1) = (9.5-1)/9.5, symmetric for 10 and 11.
        let expected = (9.5 / 10.5 + 8.5 / 9.5) / 2.;
        assert!((two.silhouette - expected).abs() < 1e-12);
        let three = &summary.cuts[1];
        assert_eq!(three.assignment, vec![0, 0, 1, 2]);
        assert_eq!(three.singletons, vec![2, 3]);
        // s(0) = (10-1)/10, s(1) = (9-1)/9, singletons score 0.
        assert!((three.silhouette - (0.9 + 8. / 9.) / 4.).abs() < 1e-12);
        assert_eq!(summary.best_groups, Some(2));
        assert!(summary.clear_grouping);
        assert_eq!(summary.silhouette_threshold, 0.25);
    }
    #[test]
    fn equidistant_members_report_no_clear_grouping() {
        let d: Vec<Vec<f64>> = (0..5)
            .map(|i| (0..5).map(|j| if i == j { 0. } else { 1. }).collect())
            .collect();
        let merges = linkage_merges(&d, Linkage::Ward, &token()).unwrap();
        let summary = grouping_summary(&d, &merges, Linkage::Ward);
        assert_eq!(summary.cuts.len(), 3);
        assert!(summary.cuts.iter().all(|c| c.silhouette.abs() < 1e-12));
        assert_eq!(summary.best_groups, Some(2));
        assert!(!summary.clear_grouping);
        // Two members: nothing to score.
        let pair = line(&[0., 1.]);
        let merges = linkage_merges(&pair, Linkage::Ward, &token()).unwrap();
        let summary = grouping_summary(&pair, &merges, Linkage::Ward);
        assert!(summary.cuts.is_empty() && summary.best_groups.is_none());
        assert!(!summary.clear_grouping);
    }
    #[test]
    fn an_outlier_is_a_singleton_not_a_group() {
        // Two groups of three plus one far member; the 3-group cut isolates it.
        let d = line(&[0., 0.5, 1., 10., 10.5, 11., 40.]);
        let merges = linkage_merges(&d, Linkage::Ward, &token()).unwrap();
        let summary = grouping_summary(&d, &merges, Linkage::Ward);
        let three = summary.cuts.iter().find(|c| c.groups == 3).unwrap();
        assert_eq!(three.assignment, vec![0, 0, 0, 1, 1, 1, 2]);
        assert_eq!(three.singletons, vec![6]);
        assert_eq!(summary.cuts.len(), 5); // 2..=6
    }
    #[test]
    fn v1_geometry_has_no_grouping_and_v3_scores_cuts() {
        let rows: Vec<Vec<f32>> = vec![
            vec![0., 0., 1.],
            vec![0.1, 0., 1.],
            vec![5., 5., 0.],
            vec![5.1, 5., 0.],
        ];
        let support = [0, 1, 2];
        let v1 = fit(&rows, &support, &Distance::Effect, &token()).unwrap();
        assert!(v1.grouping.is_none());
        assert!(!serde_json::to_string(&v1).unwrap().contains("grouping"));
        let v3 = fit_with(
            &rows,
            &support,
            &Distance::Effect,
            Some(Linkage::Ward),
            &token(),
        )
        .unwrap();
        assert_eq!(v1.distances, v3.distances);
        let grouping = v3.grouping.unwrap();
        assert_eq!(grouping.best_groups, Some(2));
        assert!(grouping.clear_grouping);
    }
}

#[cfg(test)]
mod grouping_boundary_tests {
    use super::*;
    #[test]
    fn a_silhouette_of_exactly_the_threshold_is_not_clear() {
        // Points a, b, c with d(a,b) = 5 and d(c,a) = d(c,b) = 8. The 2-group
        // cut {a,b}{c}: s(a) = s(b) = (8 - 5) / 8 = 0.375, s(c) = 0 (alone),
        // mean exactly 0.25 in binary floating point.
        let x = 8.;
        let d = vec![vec![0., 5., x], vec![5., 0., x], vec![x, x, 0.]];
        let merges = linkage_merges(&d, Linkage::Average, &SampleCancellation::default()).unwrap();
        let summary = grouping_summary(&d, &merges, Linkage::Average);
        assert_eq!(summary.cuts.len(), 1);
        assert!((summary.cuts[0].silhouette - 0.25).abs() < 1e-15);
        assert_eq!(summary.cuts[0].silhouette, 0.25);
        assert!(!summary.clear_grouping);
        let wider: Vec<Vec<f64>> = d
            .iter()
            .map(|row| row.iter().map(|&v| if v == x { 9. } else { v }).collect())
            .collect();
        let merges =
            linkage_merges(&wider, Linkage::Average, &SampleCancellation::default()).unwrap();
        assert!(grouping_summary(&wider, &merges, Linkage::Average).clear_grouping);
    }
    #[test]
    fn non_finite_distances_are_refused_not_looped_on() {
        let nan = f64::NAN;
        let d = vec![vec![0., nan, nan], vec![nan, 0., nan], vec![nan, nan, 0.]];
        for linkage in [Linkage::Ward, Linkage::Average] {
            assert!(linkage_merges(&d, linkage, &SampleCancellation::default()).is_err());
        }
    }
}
