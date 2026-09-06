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
