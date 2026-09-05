//! Two-pass histogram with O(bin_count) scratch space, finite inputs only, and
//! population moments accumulated in f64. An explicit range restricts bins,
//! while summary statistics describe all accepted voxels (the bridge contract).
use crate::{HistogramBin, HistogramResult};
use bridge_types::{BridgeError, BridgeResult, VolumeSendable};
use volmath::{DenseVolumeExt, NeuroVecTrait};

pub(crate) fn compute<I>(
    values: I,
    bin_count: u32,
    range: Option<&[f32]>,
    exclude_zeros: bool,
) -> BridgeResult<HistogramResult>
where
    I: Iterator<Item = f32> + Clone,
{
    let invalid = || BridgeError::Input {
        code: 5015,
        details: "Histogram requires 1–65536 bins and a finite, ordered two-value range".into(),
    };
    if bin_count == 0 || bin_count > 65_536 {
        return Err(invalid());
    }
    if let Some(range) = range {
        if range.len() != 2 || !range.iter().all(|v| v.is_finite()) || range[0] > range[1] {
            return Err(invalid());
        }
    }
    let values = values.filter(move |v| v.is_finite() && (!exclude_zeros || *v != 0.0));
    let mut total_count = 0u64;
    let mut sum = 0.0f64;
    let mut min_value = f32::INFINITY;
    let mut max_value = f32::NEG_INFINITY;
    for value in values.clone() {
        total_count += 1;
        sum += f64::from(value);
        min_value = min_value.min(value);
        max_value = max_value.max(value);
    }
    if total_count == 0 {
        return Ok(HistogramResult {
            bins: vec![],
            total_count: 0,
            min_value: 0.0,
            max_value: 0.0,
            mean: 0.0,
            std: 0.0,
            bin_count: 0,
        });
    }
    let mean = sum / total_count as f64;
    let (low, high) = range.map_or((min_value as f64, max_value as f64), |r| {
        (r[0] as f64, r[1] as f64)
    });
    let width = (high - low) / bin_count as f64;
    let mut counts = vec![0u64; bin_count as usize];
    let mut squared_deviation = 0.0f64;
    for value in values {
        let value = f64::from(value);
        squared_deviation += (value - mean).powi(2);
        if value >= low && value <= high {
            let index = if width == 0.0 {
                0
            } else {
                ((value - low) / width) as usize
            };
            counts[index.min(bin_count as usize - 1)] += 1;
        }
    }
    let bins = counts
        .into_iter()
        .enumerate()
        .map(|(index, count)| HistogramBin {
            x0: (low + index as f64 * width) as f32,
            x1: (low + (index + 1) as f64 * width) as f32,
            count,
        })
        .collect();
    Ok(HistogramResult {
        bins,
        total_count,
        min_value,
        max_value,
        mean: mean as f32,
        std: (squared_deviation / total_count as f64).sqrt() as f32,
        bin_count,
    })
}

pub(crate) fn for_volume(
    volume: &VolumeSendable,
    timepoint: usize,
    bin_count: u32,
    range: Option<&[f32]>,
    exclude_zeros: bool,
) -> BridgeResult<HistogramResult> {
    macro_rules! scan {
        ($volume:expr) => {
            compute(
                $volume.data().iter().map(|v| *v as f32),
                bin_count,
                range,
                exclude_zeros,
            )
        };
    }
    macro_rules! scan_4d {
        ($volume:expr) => {{
            let frame = $volume
                .volume(timepoint)
                .map_err(|error| BridgeError::Internal {
                    code: 5014,
                    details: format!(
                        "Failed to extract timepoint {timepoint} for histogram: {error}"
                    ),
                })?;
            scan!(frame)
        }};
    }
    match volume {
        VolumeSendable::VolF32(v, _) => scan!(v),
        VolumeSendable::VolF64(v, _) => scan!(v),
        VolumeSendable::VolI16(v, _) => scan!(v),
        VolumeSendable::VolI32(v, _) => scan!(v),
        VolumeSendable::VolU8(v, _) => scan!(v),
        VolumeSendable::VolU16(v, _) => scan!(v),
        VolumeSendable::VolU32(v, _) => scan!(v),
        VolumeSendable::VolI8(v, _) => scan!(v),
        VolumeSendable::Vec4DF32(v) => scan_4d!(v),
        VolumeSendable::Vec4DF64(v) => scan_4d!(v),
        VolumeSendable::Vec4DI16(v) => scan_4d!(v),
        VolumeSendable::Vec4DI32(v) => scan_4d!(v),
        VolumeSendable::Vec4DU8(v) => scan_4d!(v),
        VolumeSendable::Vec4DU16(v) => scan_4d!(v),
        VolumeSendable::Vec4DU32(v) => scan_4d!(v),
        VolumeSendable::Vec4DI8(v) => scan_4d!(v),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn histogram_analytic_moments_and_closed_upper_bin() {
        let result = compute([0., 1., 2., 3., 4.].into_iter(), 2, None, false).unwrap();
        assert_eq!(result.total_count, 5);
        assert_eq!(result.mean, 2.0);
        assert!((result.std - 2.0f32.sqrt()).abs() < 1e-6);
        assert_eq!(
            result.bins.iter().map(|b| b.count).collect::<Vec<_>>(),
            [2, 3]
        );
    }
    #[test]
    fn histogram_filters_nonfinite_and_handles_constants_and_empty_data() {
        let result = compute(
            [f32::NAN, f32::INFINITY, f32::NEG_INFINITY, 0., 7., 7.].into_iter(),
            8,
            None,
            true,
        )
        .unwrap();
        assert_eq!(result.total_count, 2);
        assert_eq!(result.mean, 7.);
        assert_eq!(result.std, 0.);
        assert_eq!(result.bins[0].count, 2);
        assert_eq!(
            compute([0., f32::NAN].into_iter(), 8, None, true)
                .unwrap()
                .total_count,
            0
        );
        let extreme = compute([f32::MAX, f32::MAX].into_iter(), 8, None, false).unwrap();
        assert_eq!(extreme.mean, f32::MAX);
        assert_eq!(extreme.std, 0.);
    }
    #[test]
    fn histogram_rejects_invalid_allocations_and_ranges() {
        for bins in [0, 65_537, u32::MAX] {
            assert!(compute([1.].into_iter(), bins, None, false).is_err());
        }
        for range in [vec![2., 1.], vec![0.], vec![0., f32::NAN]] {
            assert!(compute([1.].into_iter(), 8, Some(&range), false).is_err());
        }
    }
    #[test]
    fn histogram_seeded_conservation_translation_and_independent_bin_oracle() {
        let mut seed = 431u64;
        let values: Vec<f32> = (0..10000)
            .map(|_| {
                seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
                ((seed >> 32) % 1000) as f32 - 500.
            })
            .collect();
        let result = compute(values.iter().copied(), 10, Some(&[-500., 500.]), false).unwrap();
        let shifted = compute(
            values.iter().rev().map(|v| v + 2048.),
            10,
            Some(&[1548., 2548.]),
            false,
        )
        .unwrap();
        assert_eq!(
            result.bins.iter().map(|b| b.count).sum::<u64>(),
            values.len() as u64
        );
        for (i, bin) in result.bins.iter().enumerate() {
            let expected = values
                .iter()
                .filter(|v| **v >= -500. + i as f32 * 100. && **v < -400. + i as f32 * 100.)
                .count() as u64;
            assert_eq!(bin.count, expected);
            assert_eq!(bin.count, shifted.bins[i].count);
        }
        assert!((shifted.mean - result.mean - 2048.).abs() < 0.001);
        assert!((shifted.std - result.std).abs() < 0.001);
    }
}
