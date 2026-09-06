use field_table::{population::FieldMoments, population_inference::*};
fn reduce(values: &[f32], null: f64) -> OneSample {
    let mut m = FieldMoments::new(1, 0.).unwrap();
    for &v in values {
        m.push(&[v], None).unwrap();
    }
    let summary = m.summaries().next().unwrap();
    OneSample::from_summary(&summary, null)
}
fn close(a: f64, b: f64) {
    assert!((a - b).abs() <= 1e-11 * b.abs().max(1.), "{a} != {b}");
}
#[test]
fn analytic_mean_null_and_independent_batch_oracle() {
    let r = reduce(&[1., 2., 3., 4., 5.], 1.);
    close(r.effect.unwrap(), 2.);
    close(r.standard_error.unwrap(), 0.5_f64.sqrt());
    close(r.t.unwrap(), 8_f64.sqrt());
    assert_eq!(r.df, Some(4.));
    for scale in [1e-20_f32, 1., 1e20] {
        let values: Vec<_> = (0..41).map(|i| ((i * 17) % 23) as f32 * scale).collect();
        let null = scale as f64 * 2.;
        let r = reduce(&values, null);
        let mean = values.iter().map(|&x| x as f64).sum::<f64>() / 41.;
        let se = (values
            .iter()
            .map(|&x| (x as f64 - mean).powi(2))
            .sum::<f64>()
            / (40. * 41.))
            .sqrt();
        close(r.t.unwrap(), (mean - null) / se);
        let mut reversed = values.clone();
        reversed.reverse();
        close(reduce(&reversed, null).t.unwrap(), r.t.unwrap());
    }
}
#[test]
fn missingness_zero_variance_and_small_counts_are_explicit() {
    let r = reduce(&[1., f32::NAN, 3., f32::INFINITY], 0.);
    assert_eq!(r.count, 2);
    close(r.t.unwrap(), 2.);
    for values in [&[2., 2.][..], &[0., 0.][..]] {
        let r = reduce(values, 0.);
        assert_eq!(r.t, None);
        assert_eq!(r.standard_error, Some(0.));
        assert_eq!(r.df, Some(1.));
    }
    let r = reduce(&[3., f32::NAN], 0.);
    assert_eq!(r.effect, Some(3.));
    assert_eq!(r.standard_error, None);
    assert_eq!(r.df, None);
    let r = reduce(&[f32::NAN], 0.);
    assert_eq!(r.effect, None);
    assert_eq!(r.count, 0);
}
#[test]
fn published_nist_reference_and_large_offset_null() {
    // Published source: https://www.itl.nist.gov/div898/handbook/eda/section3/eda352.htm
    // Use its 195 raw ZARR13 observations, not rounded printed mean/SD.
    let values: Vec<f32> = include_str!("../fixtures/population/ZARR13.DAT")
        .lines()
        .filter_map(|line| line.trim().parse().ok())
        .collect();
    assert_eq!(values.len(), 195);
    let result = reduce(&values, 5.);
    // Independent Python statistics batch reference on the same float32 inputs.
    close(result.t.unwrap(), 2611.283864062065);
    assert!((result.t.unwrap() - 2611.284).abs() < 0.001);
    let base = reduce(&[0., 2., 4.], 2.);
    let shifted = reduce(&[16777216., 16777218., 16777220.], 16777218.);
    assert_eq!(base, shifted);
}
#[test]
fn readiness_refuses_wrong_roles_units_independence_and_duplicate_people() {
    let mut s = Specification {
        method: Method::OneSample,
        role: FeatureRole::Effect,
        units: "percent signal change".into(),
        null_value: 0.,
        independent_participants: true,
        selection_origin: SelectionOrigin::MapDerived,
        channel: Channel::Effect,
    };
    assert!(s.validate(&["A", "B"]).is_ok());
    assert!(s.validate(&["A", "A"]).is_err());
    assert!(s.validate(&["A"]).is_err());
    for role in [
        FeatureRole::T,
        FeatureRole::Z,
        FeatureRole::Variance,
        FeatureRole::StandardError,
        FeatureRole::Label,
        FeatureRole::Other,
    ] {
        s.role = role;
        assert!(s.validate(&["A", "B"]).is_err());
    }
    s.role = FeatureRole::Effect;
    s.units.clear();
    assert!(s.validate(&["A", "B"]).is_err());
    s.units = "a.u.".into();
    s.independent_participants = false;
    assert!(s.validate(&["A", "B"]).is_err());
}

fn summary(values: &[f32]) -> field_table::population::LocationSummary {
    let mut m = FieldMoments::new(1, 0.).unwrap();
    for &v in values {
        m.push(&[v], None).unwrap();
    }
    let result = m.summaries().next().unwrap();
    result
}
#[test]
fn welch_matches_independent_r_and_analytic_unequal_variance_results() {
    let a = summary(&[1., 2., 6., 9.]);
    let b = summary(&[-3., 0., 2., 3., 12.]);
    let w = Welch::from_summaries(&a, &b, 0.7);
    // R stats::t.test, default var.equal=FALSE, on the original samples.
    close(w.t.unwrap(), 0.3201468743906424);
    close(w.df.unwrap(), 6.828682660312849);
    close(w.standard_error.unwrap(), 3.1235663378047);
    let swapped = Welch::from_summaries(&b, &a, -0.7);
    close(swapped.t.unwrap(), -w.t.unwrap());
    close(swapped.df.unwrap(), w.df.unwrap());
    for scale in [1e-20_f32, 1., 1e20] {
        let a: Vec<_> = [1., 2., 3.].iter().map(|v| v * scale).collect();
        let b: Vec<_> = [4., 6., 8.].iter().map(|v| v * scale).collect();
        let w = Welch::from_summaries(&summary(&a), &summary(&b), 0.);
        assert!((w.t.unwrap() - -4. / (5_f64 / 3.).sqrt()).abs() < 2e-6);
        assert!((w.df.unwrap() - 50. / 17.).abs() < 2e-6);
    }
    let shifted = Welch::from_summaries(
        &summary(&[16777216., 16777218., 16777220.]),
        &summary(&[16777222., 16777224., 16777228.]),
        0.,
    );
    let original = Welch::from_summaries(&summary(&[0., 2., 4.]), &summary(&[6., 8., 12.]), 0.);
    // Centered-moment updates round the running mean in original units.
    // Propagate a small number of f64 ulps at the offset through the final SE;
    // an absolute tolerance independent of location is not a translation guarantee.
    let bound = 8. * f64::EPSILON * 16777228. / original.standard_error.unwrap();
    assert!((shifted.t.unwrap() - original.t.unwrap()).abs() <= bound);
}
#[test]
fn welch_preserves_group_counts_and_refuses_undefined_local_evidence() {
    let a = summary(&[1., 3., 5.]);
    let b = summary(&[2., f32::NAN, f32::INFINITY]);
    let w = Welch::from_summaries(&a, &b, 0.);
    assert_eq!((w.count_a, w.count_b), (3, 1));
    assert_eq!(w.effect, Some(1.));
    assert_eq!(w.standard_error, None);
    assert_eq!(w.t, None);
    assert_eq!(w.df, None);
    let constant = summary(&[2., 2., 2.]);
    let w = Welch::from_summaries(&a, &constant, 0.);
    close(w.df.unwrap(), 2.); // One zero-variance group is admissible.
    let w = Welch::from_summaries(&constant, &constant, 0.);
    assert_eq!(w.standard_error, Some(0.));
    assert_eq!(w.t, None);
    assert_eq!(w.df, None);
    assert_eq!(
        Welch::from_summaries(&a, &summary(&[f32::NAN]), 0.).effect,
        None
    );
}
#[test]
fn catalog_is_complete_and_channels_are_method_specific() {
    use field_table::population_inference::catalog::methods;
    use std::collections::HashSet;
    assert_eq!(methods().len(), 2);
    let mut ids = HashSet::new();
    for d in methods() {
        assert!(ids.insert(serde_json::to_string(&d.id).unwrap()));
        assert_eq!(d.version, 1);
        assert!(d.channels.iter().any(|c| c.id == d.default_channel));
        let mut names = HashSet::new();
        for c in &d.channels {
            assert!(names.insert(&c.artifact));
            assert!(!c.artifact.contains('/') && c.artifact.ends_with(".nii.gz"));
            assert!(!["summary.nii.gz", "coverage.nii.gz"].contains(&c.artifact.as_str()));
        }
    }
    assert!(serde_json::from_str::<Method>("\"futureUninstalledMethod\"").is_err());
    let a = summary(&[1., 2., 3.]);
    assert!(Method::Welch.evaluate(&a, None, 0.).is_err());
    assert!(Method::OneSample.evaluate(&a, Some(&a), 0.).is_err());
    assert!(Method::Welch
        .descriptor()
        .channels
        .iter()
        .all(|c| c.id != Channel::Count));
}
