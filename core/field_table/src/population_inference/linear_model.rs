//! Ordinary least squares on an explicit participant-keyed design. Finite
//! responses define a local complete-case fit; no covariate imputation or
//! automatic column dropping. Standard errors assume homoskedastic errors.
use super::{Estimate, OneSample};
use nalgebra::{DMatrix, DVector};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LinearDesign {
    pub participant_ids: Vec<String>,
    pub columns: Vec<String>,
    pub values: Vec<Vec<f64>>,
    pub contrast: Vec<f64>,
    pub contrast_units: String,
}
impl LinearDesign {
    pub fn validate(&self, participants: &[&str]) -> Result<(), &'static str> {
        let p = self.columns.len();
        if !(1..=8).contains(&p)
            || participants.len() <= p
            || participants.len() > 512
            || self.participant_ids.len() != participants.len()
            || self.participant_ids.iter().collect::<HashSet<_>>().len() != participants.len()
            || self
                .participant_ids
                .iter()
                .any(|id| !participants.contains(&id.as_str()))
            || self.values.len() != participants.len()
            || self
                .columns
                .iter()
                .any(|s| s.trim().is_empty() || s.len() > 128)
            || self.columns.iter().collect::<HashSet<_>>().len() != p
            || self
                .values
                .iter()
                .any(|r| r.len() != p || r[0] != 1. || !r.iter().all(|v| v.is_finite()))
            || self.contrast.len() != p
            || !self.contrast.iter().all(|v| v.is_finite())
            || self.contrast.iter().all(|&v| v == 0.)
            || self.contrast_units.trim().is_empty()
            || self.contrast_units.len() > 128
        {
            return Err("OLS requires 1-8 named design columns (first column is an intercept), an explicit nonzero contrast and units, and p+1 to 512 exactly matched participants with finite covariates.");
        }
        self.factor(&(0..participants.len()).collect::<Vec<_>>()).ok_or("The declared design is rank deficient or ill-conditioned; no columns are silently dropped.")?;
        Ok(())
    }
    fn factor(&self, indices: &[usize]) -> Option<Factor> {
        let n = indices.len();
        let p = self.columns.len();
        if n <= p {
            return None;
        }
        // Normalize columns before SVD so physical covariate units alone cannot
        // trigger the relative rank threshold. Coefficients retain original units.
        let scales: Vec<f64> = (0..p)
            .map(|j| {
                indices
                    .iter()
                    .map(|&i| self.values[i][j].abs())
                    .fold(0., f64::max)
            })
            .collect();
        if scales.iter().any(|&s| s == 0. || !s.is_finite()) {
            return None;
        }
        let x = DMatrix::from_fn(n, p, |i, j| self.values[indices[i]][j] / scales[j]);
        let svd = x.clone().svd(true, true);
        let max = svd.singular_values.max();
        if svd.singular_values.iter().any(|&s| s <= max * 1e-10) {
            return None;
        }
        let inverse = svd.pseudo_inverse(max * 1e-10).ok()?;
        let contrast =
            DVector::from_iterator(p, self.contrast.iter().zip(&scales).map(|(c, s)| c / s));
        let weights = inverse.transpose() * contrast;
        let variance_multiplier = weights.norm_squared();
        if !variance_multiplier.is_finite() {
            return None;
        }
        Some(Factor {
            x,
            inverse,
            weights,
            variance_multiplier,
        })
    }
    /// Response rows must have the exact order declared by participant_ids.
    pub fn evaluate(&self, rows: &[Vec<f64>], null: f64) -> Result<Vec<Estimate>, &'static str> {
        self.validate(
            &self
                .participant_ids
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>(),
        )?;
        if !null.is_finite()
            || rows.len() != self.values.len()
            || rows.is_empty()
            || rows.iter().any(|r| r.len() != rows[0].len())
        {
            return Err("OLS response shape or null is invalid.");
        }
        // At most 256 missingness patterns are cached, independently of field size.
        let mut factors = std::collections::HashMap::<Vec<usize>, Option<Factor>>::new();
        let mut results = Vec::with_capacity(rows[0].len());
        for j in 0..rows[0].len() {
            let indices: Vec<usize> = (0..rows.len())
                .filter(|&i| rows[i][j].is_finite())
                .collect();
            if !factors.contains_key(&indices) {
                if factors.len() >= 256 {
                    factors.clear();
                }
                factors.insert(indices.clone(), self.factor(&indices));
            }
            let mut result = OneSample {
                effect: None,
                standard_error: None,
                t: None,
                df: None,
                count: indices.len() as u64,
            };
            if let Some(factor) = &factors[&indices] {
                let baseline = rows[indices[0]][j];
                let y = DVector::from_iterator(
                    indices.len(),
                    indices.iter().map(|&i| rows[i][j] - baseline),
                );
                let coefficients = &factor.inverse * &y;
                let residual = &y - &factor.x * coefficients;
                let df = (indices.len() - self.columns.len()) as f64;
                let effect = factor.weights.dot(&y) + self.contrast[0] * baseline - null;
                let se = (residual.norm_squared() / df * factor.variance_multiplier).sqrt();
                if effect.is_finite() {
                    result.effect = Some(effect);
                }
                if se.is_finite() {
                    result.standard_error = Some(se);
                }
                if se > 0. && (effect / se).is_finite() {
                    result.t = Some(effect / se);
                }
                result.df = Some(df);
            }
            results.push(Estimate::LinearModel(result));
        }
        Ok(results)
    }
}
struct Factor {
    x: DMatrix<f64>,
    inverse: DMatrix<f64>,
    weights: DVector<f64>,
    variance_multiplier: f64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::population_inference::Channel;
    fn design() -> LinearDesign {
        LinearDesign {
            participant_ids: (0..6).map(|i| i.to_string()).collect(),
            columns: vec!["Intercept".into(), "x".into(), "z".into()],
            values: (0..6).map(|i| vec![1., i as f64, (i % 2) as f64]).collect(),
            contrast: vec![0., 1., 0.],
            contrast_units: "effect / x".into(),
        }
    }
    #[test]
    fn coefficients_and_missing_response_se_match_independent_r_lm() {
        // R 4.x stats::lm(y ~ x + z); fixture generated independently with QR.
        let rows: Vec<_> = [1., 2., 5., 4., 9., 8.]
            .iter()
            .enumerate()
            .map(|(i, &v)| vec![v, if i == 3 { f64::NAN } else { v }])
            .collect();
        let d = design();
        let result = d.evaluate(&rows, 0.).unwrap();
        for (i, se, df, count) in [
            (0, 0.1863389981249824, 3., 6.),
            (1, 0.176_776_695_296_637, 2., 5.),
        ] {
            assert!((result[i].value(&Channel::Effect).unwrap() - 1.75).abs() < 1e-12);
            assert!((result[i].value(&Channel::StandardError).unwrap() - se).abs() < 1e-12);
            assert_eq!(result[i].value(&Channel::Df), Some(df));
            assert_eq!(result[i].value(&Channel::Count), Some(count));
        }
        let shifted: Vec<_> = rows
            .iter()
            .map(|r| r.iter().map(|v| v + 1e8).collect())
            .collect();
        let shift = d.evaluate(&shifted, 0.).unwrap();
        assert!((shift[0].value(&Channel::Effect).unwrap() - 1.75).abs() < 1e-12);
        let mut scaled = d.clone();
        for row in &mut scaled.values {
            row[1] *= 1e9;
        }
        let scaled = scaled.evaluate(&rows, 0.).unwrap();
        assert!((scaled[0].value(&Channel::Effect).unwrap() * 1e9 - 1.75).abs() < 1e-12);
    }
    #[test]
    fn rank_and_identity_failures_are_explicit_and_local_rank_loss_is_unavailable() {
        let mut d = design();
        d.values.iter_mut().for_each(|r| r[2] = r[1]);
        assert!(d.evaluate(&vec![vec![1.]; 6], 0.).is_err());
        let d = design();
        let rows: Vec<_> = (0..6)
            .map(|i| vec![if i % 2 == 1 { f64::NAN } else { i as f64 }])
            .collect();
        let result = d.evaluate(&rows, 0.).unwrap();
        assert_eq!(result[0].value(&Channel::Count), Some(3.));
        assert_eq!(result[0].value(&Channel::Effect), None);
        let mut broken = d.clone();
        broken.participant_ids[0] = "1".into();
        assert!(broken.evaluate(&rows, 0.).is_err());
        let order = [5, 2, 0, 4, 1, 3];
        let mut permuted = d.clone();
        permuted.participant_ids = order
            .iter()
            .map(|&i| d.participant_ids[i].clone())
            .collect();
        permuted.values = order.iter().map(|&i| d.values[i].clone()).collect();
        let y: Vec<_> = [1., 2., 5., 4., 9., 8.].iter().map(|&v| vec![v]).collect();
        let reference = d.evaluate(&y, 0.).unwrap();
        let output = permuted
            .evaluate(&order.iter().map(|&i| y[i].clone()).collect::<Vec<_>>(), 0.)
            .unwrap();
        assert!(
            (reference[0].value(&Channel::T).unwrap() - output[0].value(&Channel::T).unwrap())
                .abs()
                < 1e-10
        );
    }
}
