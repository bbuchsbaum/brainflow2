//! Unequal-variance difference of independent participant means.
use super::{Channel, OneSample};
use crate::population::LocationSummary;

#[derive(Debug)]
pub struct Welch {
    pub effect: Option<f64>,
    pub standard_error: Option<f64>,
    pub t: Option<f64>,
    pub df: Option<f64>,
    pub count_a: u64,
    pub count_b: u64,
}
impl Welch {
    pub fn from_summaries(a: &LocationSummary, b: &LocationSummary, null: f64) -> Self {
        let effect = a
            .mean
            .zip(b.mean)
            .map(|(a, b)| (a - b) - null)
            .filter(|v| v.is_finite());
        let errors = OneSample::from_summary(a, 0.)
            .standard_error
            .zip(OneSample::from_summary(b, 0.).standard_error);
        // hypot avoids overflow/underflow from squaring the standard errors.
        let standard_error = errors.map(|(a, b)| a.hypot(b)).filter(|v| v.is_finite());
        let t = effect
            .zip(standard_error)
            .and_then(|(e, se)| (se > 0.).then_some(e / se))
            .filter(|v| v.is_finite());
        // Normalize first: no fourth powers of raw signal units.
        let df = errors
            .zip(standard_error)
            .and_then(|((sa, sb), se)| {
                if se <= 0. {
                    return None;
                }
                let wa = (sa / se).powi(2);
                let wb = (sb / se).powi(2);
                Some(
                    1. / (wa * wa / (a.valid_count - 1) as f64
                        + wb * wb / (b.valid_count - 1) as f64),
                )
            })
            .filter(|v| v.is_finite());
        Self {
            effect,
            standard_error,
            t,
            df,
            count_a: a.valid_count,
            count_b: b.valid_count,
        }
    }
    pub fn value(&self, channel: &Channel) -> Option<f64> {
        match channel {
            Channel::Effect => self.effect,
            Channel::StandardError => self.standard_error,
            Channel::T => self.t,
            Channel::Df => self.df,
            Channel::CountA => Some(self.count_a as f64),
            Channel::CountB => Some(self.count_b as f64),
            Channel::Count => None,
        }
    }
}
