use field_table::population::{FieldMoments, PopulationError, SignCounts};

fn close(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        actual.is_finite() && (actual - expected).abs() <= tolerance,
        "actual={actual:e}, expected={expected:e}, tolerance={tolerance:e}"
    );
}

#[test]
fn identical_means_reveal_shared_opposing_and_minority_patterns() {
    let mut fields = FieldMoments::new(3, 0.0).unwrap();
    for i in 0..80 {
        fields
            .push(
                &[
                    1.0,
                    if i < 40 { 3.0 } else { -1.0 },
                    if i < 8 { 10.0 } else { 0.0 },
                ],
                None,
            )
            .unwrap();
    }
    let summaries: Vec<_> = fields.summaries().collect();
    for summary in &summaries {
        close(summary.mean.unwrap(), 1.0, 1e-14);
        assert_eq!(summary.valid_count, 80);
        assert_eq!(summary.eligible_count, 80);
    }
    assert_eq!(summaries[0].sample_sd, Some(0.0));
    assert_eq!(summaries[0].cancellation, Some(0.0));
    close(
        summaries[1].sample_sd.unwrap(),
        (320.0f64 / 79.0).sqrt(),
        1e-14,
    );
    close(summaries[1].cancellation.unwrap(), 1.0, 1e-14);
    assert_eq!(
        summaries[1].signs,
        SignCounts {
            positive: 40,
            negative: 40,
            near_zero: 0
        }
    );
    close(
        summaries[2].sample_sd.unwrap(),
        (720.0f64 / 79.0).sqrt(),
        1e-14,
    );
    close(summaries[2].cancellation.unwrap(), 0.0, 1e-14);
    assert_eq!(
        summaries[2].signs,
        SignCounts {
            positive: 8,
            negative: 0,
            near_zero: 72
        }
    );
}

#[test]
fn masks_and_nonfinite_values_have_local_denominators() {
    let mut fields = FieldMoments::new(4, 0.0).unwrap();
    fields
        .push(
            &[0.0, 12.0, f32::INFINITY, f32::NAN],
            Some(&[true, false, true, true]),
        )
        .unwrap();
    fields
        .push(&[f32::NAN, 4.0, -f32::INFINITY, f32::NAN], None)
        .unwrap();
    let summaries: Vec<_> = fields.summaries().collect();
    assert_eq!(summaries[0].mean, Some(0.0));
    assert_eq!(summaries[0].valid_count, 1);
    assert_eq!(summaries[0].sample_sd, None);
    assert_eq!(summaries[1].mean, Some(4.0));
    assert_eq!(summaries[1].eligible_count, 2);
    for summary in &summaries[2..] {
        assert_eq!(summary.valid_count, 0);
        assert_eq!(summary.mean, None);
        assert_eq!(summary.sample_sd, None);
        assert_eq!(summary.cancellation, None);
        assert_eq!(summary.signs, SignCounts::default());
    }
}

#[test]
fn near_zero_endpoints_are_inclusive_and_do_not_change_cancellation() {
    let mut fields = FieldMoments::new(1, 0.5).unwrap();
    for x in [-1.0, -0.5, 0.0, 0.5, 1.0] {
        fields.push(&[x], None).unwrap();
    }
    let summary = fields.summaries().next().unwrap();
    assert_eq!(
        summary.signs,
        SignCounts {
            positive: 1,
            negative: 1,
            near_zero: 3
        }
    );
    close(summary.cancellation.unwrap(), 0.6, 1e-15);
}

#[test]
fn empty_selection_is_unavailable_and_invalid_pushes_are_atomic() {
    let mut fields = FieldMoments::new(2, 0.0).unwrap();
    let empty = fields.summaries().collect::<Vec<_>>();
    assert!(empty
        .iter()
        .all(|s| s.mean.is_none() && s.eligible_count == 0));
    assert!(matches!(
        fields.push(&[1.0], None),
        Err(PopulationError::Shape { .. })
    ));
    assert!(matches!(
        fields.push(&[1.0, 2.0], Some(&[true])),
        Err(PopulationError::MaskShape { .. })
    ));
    assert_eq!(fields.summaries().collect::<Vec<_>>(), empty);
    assert!(FieldMoments::new(0, 0.0).is_err());
    for near_zero in [f64::NAN, f64::INFINITY, -1.0] {
        assert!(FieldMoments::new(2, near_zero).is_err());
    }
}

// Independent oracle: two-pass sums of exactly represented shifted inputs.
// Does not call the online recurrence, block merge or materialization code.
fn batch_reference(values: &[f32]) -> (f64, f64, f64) {
    let values: Vec<f64> = values
        .iter()
        .copied()
        .filter(|v| v.is_finite())
        .map(f64::from)
        .collect();
    let origin = values[0];
    let centered_mean = values.iter().map(|v| v - origin).sum::<f64>() / values.len() as f64;
    let variance = values
        .iter()
        .map(|v| ((v - origin) - centered_mean).powi(2))
        .sum::<f64>()
        / (values.len() - 1) as f64;
    let mean = origin + centered_mean;
    let cancellation =
        values.iter().map(|v| v.abs()).sum::<f64>() / values.len() as f64 - mean.abs();
    (mean, variance.sqrt(), cancellation.max(0.0))
}

#[test]
fn streaming_and_partition_merges_match_independent_batch_with_large_offsets() {
    let values: Vec<f32> = (0..4096)
        .map(|i| {
            if i % 17 == 0 {
                f32::NAN
            } else {
                16_777_216.0 + ((i * 137 % 103) * 2) as f32
            }
        })
        .collect();
    let (mean, sd, _) = batch_reference(&values);
    let mut serial = FieldMoments::new(1, 0.0).unwrap();
    let mut merged = FieldMoments::new(1, 0.0).unwrap();
    for block in values.chunks(37) {
        let mut partial = FieldMoments::new(1, 0.0).unwrap();
        for &value in block {
            serial.push(&[value], None).unwrap();
            partial.push(&[value], None).unwrap();
        }
        merged.merge(&partial).unwrap();
    }
    for result in [&serial, &merged] {
        let summary = result.summaries().next().unwrap();
        close(summary.mean.unwrap(), mean, 1e-7);
        close(summary.sample_sd.unwrap(), sd, 1e-8);
        assert_eq!(
            summary.valid_count,
            values.iter().filter(|v| v.is_finite()).count() as u64
        );
        assert_eq!(summary.eligible_count, 4096);
    }
}

#[test]
fn signed_scaling_and_permutation_preserve_expected_statistics() {
    let values: Vec<f32> = (0..80)
        .map(|i| ((i * 23 % 41) as f32 - 20.0) / 4.0)
        .collect();
    let (mean, sd, cancellation) = batch_reference(&values);
    for scale in [-8.0f32, 1.0, 4.0] {
        let mut fields = FieldMoments::new(1, 0.0).unwrap();
        for &value in values.iter().rev() {
            fields.push(&[value * scale], None).unwrap();
        }
        let summary = fields.summaries().next().unwrap();
        close(summary.mean.unwrap(), mean * f64::from(scale), 1e-13);
        close(
            summary.sample_sd.unwrap(),
            sd * f64::from(scale.abs()),
            1e-13,
        );
        close(
            summary.cancellation.unwrap(),
            cancellation * f64::from(scale.abs()),
            1e-13,
        );
    }
}

#[test]
fn incompatible_merges_and_count_overflow_leave_results_unchanged() {
    let mut fields = FieldMoments::new(1, 0.0).unwrap();
    fields.push(&[1.0], None).unwrap();
    let before = fields.summaries().collect::<Vec<_>>();
    assert_eq!(
        fields.merge(&FieldMoments::new(1, 1.0).unwrap()),
        Err(PopulationError::IncompatibleThreshold)
    );
    assert!(fields.merge(&FieldMoments::new(2, 0.0).unwrap()).is_err());
    assert_eq!(fields.summaries().collect::<Vec<_>>(), before);
    for _ in 0..63 {
        fields.merge(&fields.clone()).unwrap();
    }
    let before = fields.summaries().collect::<Vec<_>>();
    assert_eq!(
        fields.merge(&fields.clone()),
        Err(PopulationError::CountOverflow)
    );
    assert_eq!(fields.summaries().collect::<Vec<_>>(), before);
}

#[test]
fn spatial_blocks_match_full_support_and_bound_scratch_memory() {
    let rows: Vec<Vec<f32>> = (0..80)
        .map(|i| (0..1024).map(|j| (i - j) as f32).collect())
        .collect();
    let mut full = FieldMoments::new(1024, 0.0).unwrap();
    for row in &rows {
        full.push(row, None).unwrap();
    }
    let expected: Vec<_> = full.summaries().collect();
    let mut actual = Vec::new();
    for start in (0..1024).step_by(32) {
        let mut block = FieldMoments::new(32, 0.0).unwrap();
        assert!(block.allocated_bytes() <= full.allocated_bytes() / 32);
        for row in &rows {
            block.push(&row[start..start + 32], None).unwrap();
        }
        actual.extend(block.summaries());
    }
    assert_eq!(actual, expected);
}

#[test]
fn participant_means_have_equal_weight_local_counts_and_unrounded_spread() {
    let mut moments = FieldMoments::new(2, 0.).unwrap();
    moments
        .push_mean(&[&[0., f32::NAN], &[0., f32::NAN], &[0., f32::NAN]])
        .unwrap();
    moments.push_mean(&[&[8., 8.]]).unwrap();
    let stats: Vec<_> = moments.summaries().collect();
    assert_eq!(stats[0].mean, Some(4.)); // equal people, not equal rows (which gives 2)
    assert_eq!(stats[0].valid_count, 2);
    assert_eq!(stats[1].mean, Some(8.));
    assert_eq!(stats[1].valid_count, 1);
    assert_eq!(stats[1].eligible_count, 2);
    let mut precise = FieldMoments::new(1, 0.).unwrap();
    precise
        .push_mean(&[&[16_777_216.], &[16_777_218.]])
        .unwrap();
    precise.push_mean(&[&[16_777_216.]]).unwrap();
    let s = precise.summaries().next().unwrap();
    assert_eq!(s.mean, Some(16_777_216.5));
    assert!((s.sample_sd.unwrap() - 0.5f64.sqrt()).abs() < 1e-12);
    let before = precise.summaries().next().unwrap();
    assert!(precise.push_mean(&[]).is_err());
    assert!(precise.push_mean(&[&[1.], &[1., 2.]]).is_err());
    assert_eq!(precise.summaries().next().unwrap(), before);
}
