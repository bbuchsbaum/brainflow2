//! The same finite participant estimator feeds visible channels and full export.
use super::*;
use field_table::{
    population::LocationSummary,
    population_inference::{Channel, OneSample, Specification},
};

pub(super) fn validate(request: &PopulationSliceRequest) -> BridgeResult<()> {
    if let Some(spec) = &request.inference {
        if !request.groups.is_empty()
            || request.reference.is_some()
            || request.difference
            || !matches!(request.summary, SummaryKind::Mean)
        {
            return Err(input("One-sample inference uses A's participant effects; return to Inspect and the mean channel first."));
        }
        let aggregation = request.aggregation.as_ref().ok_or_else(|| {
            input("Declare participant identities and a within-person reduction before testing.")
        })?;
        spec.validate(
            &aggregation
                .groups
                .iter()
                .map(|g| g.participant_id.as_str())
                .collect::<Vec<_>>(),
        )
        .map_err(input)?;
    }
    Ok(())
}
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Channels {
    pub effect: Vec<Option<f32>>,
    pub standard_error: Vec<Option<f32>>,
    pub t: Vec<Option<f32>>,
    pub df: Vec<Option<f32>>,
    pub count: Vec<Option<f32>>,
}
impl Channels {
    pub fn selected(&self, channel: &Channel) -> &[Option<f32>] {
        match channel {
            Channel::Effect => &self.effect,
            Channel::StandardError => &self.standard_error,
            Channel::T => &self.t,
            Channel::Df => &self.df,
            Channel::Count => &self.count,
        }
    }
}
pub(super) fn channels(
    summaries: &[LocationSummary],
    pixels: &[Option<usize>],
    spec: &Specification,
) -> Channels {
    let native: Vec<_> = summaries
        .iter()
        .map(|s| OneSample::from_summary(s, spec.null_value))
        .collect();
    let gather = |channel| {
        pixels
            .iter()
            .map(|slot| {
                slot.and_then(|i| native[i].value(&channel))
                    .map(|v| v as f32)
                    .filter(|v| v.is_finite())
            })
            .collect()
    };
    Channels {
        effect: gather(Channel::Effect),
        standard_error: gather(Channel::StandardError),
        t: gather(Channel::T),
        df: gather(Channel::Df),
        count: gather(Channel::Count),
    }
}
