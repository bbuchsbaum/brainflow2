//! Participant-level statistical inference from stable, locally finite moments.
//! Geometry and the within-person reduction precede this kernel. Declarations
//! are explicit user assertions, not evidence of independence or valid selection.
use crate::population::LocationSummary;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
pub mod catalog;
mod welch;
pub use welch::Welch;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FeatureRole {
    Effect,
    StandardError,
    Variance,
    T,
    Z,
    Label,
    Other,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Method {
    OneSample,
    Welch,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SelectionOrigin {
    Manual,
    Metadata,
    MapDerived,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum Channel {
    Effect,
    StandardError,
    T,
    Df,
    Count,
    CountA,
    CountB,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Specification {
    pub method: Method,
    pub role: FeatureRole,
    pub units: String,
    pub null_value: f64,
    pub independent_participants: bool,
    pub selection_origin: SelectionOrigin,
    pub channel: Channel,
}
impl Specification {
    pub fn validate(&self, participants: &[&str]) -> Result<(), &'static str> {
        let descriptor = self.method.descriptor();
        if !descriptor.channels.iter().any(|c| c.id == self.channel) {
            return Err("The selected channel is not produced by this statistical method.");
        }
        if !descriptor.accepted_roles.contains(&self.role) {
            return Err("Testing requires effect estimates, not t/z, uncertainty or label maps.");
        }
        if self.units.trim().is_empty() || self.units.len() > 128 {
            return Err("Declare comparable effect units (at most 128 bytes).");
        }
        if !self.null_value.is_finite() {
            return Err("The null effect must be finite.");
        }
        if !self.independent_participants {
            return Err("Declare independent participant effects before testing.");
        }
        if participants.len() < descriptor.minimum_participants
            || participants.iter().any(|id| id.trim().is_empty())
            || participants.iter().collect::<HashSet<_>>().len() != participants.len()
        {
            return Err("Testing requires at least two uniquely identified participants.");
        }
        Ok(())
    }
}
#[derive(Clone, Debug, PartialEq)]
pub struct OneSample {
    pub effect: Option<f64>,
    pub standard_error: Option<f64>,
    pub t: Option<f64>,
    pub df: Option<f64>,
    pub count: u64,
}
impl OneSample {
    pub fn from_summary(s: &LocationSummary, null: f64) -> Self {
        let effect = s.mean.map(|m| m - null).filter(|v| v.is_finite());
        let standard_error = (s.valid_count >= 2)
            .then(|| s.sample_sd.map(|sd| sd / (s.valid_count as f64).sqrt()))
            .flatten()
            .filter(|v| v.is_finite() && *v >= 0.);
        let t = effect
            .zip(standard_error)
            .and_then(|(e, se)| (se > 0.).then_some(e / se))
            .filter(|v| v.is_finite());
        Self {
            effect,
            standard_error,
            t,
            df: (s.valid_count >= 2).then_some(s.valid_count.saturating_sub(1) as f64),
            count: s.valid_count,
        }
    }
    pub fn value(&self, channel: &Channel) -> Option<f64> {
        match channel {
            Channel::Effect => self.effect,
            Channel::StandardError => self.standard_error,
            Channel::T => self.t,
            Channel::Df => self.df,
            Channel::Count => Some(self.count as f64),
            Channel::CountA | Channel::CountB => None,
        }
    }
}

/// The output payload belongs to its estimator; the renderer requests declared channels.
#[derive(Debug)]
pub enum Estimate {
    OneSample(OneSample),
    Welch(Welch),
}
impl Estimate {
    pub fn value(&self, channel: &Channel) -> Option<f64> {
        match self {
            Self::OneSample(r) => r.value(channel),
            Self::Welch(r) => r.value(channel),
        }
    }
}
impl Method {
    /// New input designs need a typed adapter, not an unvalidated parameter bag.
    pub fn evaluate(
        &self,
        a: &LocationSummary,
        b: Option<&LocationSummary>,
        null: f64,
    ) -> Result<Estimate, &'static str> {
        match self {
            Self::OneSample => {
                if b.is_some() {
                    return Err("One-sample inference requires one population.");
                }
                Ok(Estimate::OneSample(OneSample::from_summary(a, null)))
            }
            Self::Welch => Ok(Estimate::Welch(Welch::from_summaries(
                a,
                b.ok_or("Welch inference requires population B.")?,
                null,
            ))),
        }
    }
}
