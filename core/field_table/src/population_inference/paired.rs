//! Typed input adapter: marginal A/B moments cannot recover within-person covariance.
use super::{Estimate, OneSample};
use crate::population::{FieldMoments, PopulationError};
pub struct PairedMoments(FieldMoments);
impl PairedMoments {
    pub fn new(locations: usize) -> Result<Self, PopulationError> {
        Ok(Self(FieldMoments::new(locations, 0.)?))
    }
    /// The caller supplies one identified participant, with distinct A/B rows.
    pub fn push(&mut self, a: &[&[f32]], b: &[&[f32]]) -> Result<(), PopulationError> {
        self.0.push_mean_difference(a, b)
    }
    pub fn estimates(&self, null: f64) -> impl Iterator<Item = Estimate> + '_ {
        self.0
            .summaries()
            .map(move |s| Estimate::Paired(OneSample::from_summary(&s, null)))
    }
}
