//! Method-specific readiness and channel families shared by live and full export.
use super::*;
use field_table::{
    population::LocationSummary,
    population_inference::{catalog::Inputs, Channel, Specification},
};
use std::collections::BTreeMap;

pub(super) fn validate(request: &PopulationSliceRequest) -> BridgeResult<()> {
    if let Some(spec) = &request.inference {
        if !request.groups.is_empty()
            || request.difference
            || !matches!(request.summary, SummaryKind::Mean)
        {
            return Err(input(
                "Statistical inference requires the Inspect arrangement.",
            ));
        }
        let participants =
            |aggregation: &Option<ParticipantAggregation>| -> BridgeResult<Vec<String>> {
                Ok(aggregation.as_ref().ok_or_else(|| input("Declare participant identities and a within-person reduction before testing."))?.groups.iter().map(|g| g.participant_id.clone()).collect())
            };
        let a = participants(&request.aggregation)?;
        spec.validate(&a.iter().map(String::as_str).collect::<Vec<_>>())
            .map_err(input)?;
        match spec.method.descriptor().inputs {
            Inputs::OnePopulation => {
                if request.reference.is_some() {
                    return Err(input("One-sample inference requires only population A."));
                }
            }
            Inputs::IndependentGroups => {
                let reference = request.reference.as_ref().ok_or_else(|| {
                    input("Choose population B before comparing independent groups.")
                })?;
                let b = participants(&reference.aggregation)?;
                spec.validate(&b.iter().map(String::as_str).collect::<Vec<_>>())
                    .map_err(input)?;
                if b.iter().any(|id| a.contains(id)) {
                    return Err(input("Independent-group testing requires disjoint participant IDs in A and B; overlapping people require a paired or repeated-measures method."));
                }
            }
        }
    }
    Ok(())
}
#[derive(Debug, serde::Serialize)]
#[serde(transparent)]
pub struct Channels(pub BTreeMap<Channel, Vec<Option<f32>>>);
impl Channels {
    pub fn selected(&self, channel: &Channel) -> &[Option<f32>] {
        &self.0[channel]
    }
}
pub(super) fn channels(
    summaries: &[LocationSummary],
    reference: Option<&[LocationSummary]>,
    pixels: &[Option<usize>],
    spec: &Specification,
) -> BridgeResult<Channels> {
    let native = summaries
        .iter()
        .enumerate()
        .map(|(i, a)| {
            spec.method
                .evaluate(a, reference.map(|b| &b[i]), spec.null_value)
                .map_err(input)
        })
        .collect::<BridgeResult<Vec<_>>>()?;
    Ok(Channels(
        spec.method
            .descriptor()
            .channels
            .iter()
            .map(|channel| {
                let values = pixels
                    .iter()
                    .map(|slot| {
                        slot.and_then(|i| native[i].value(&channel.id))
                            .map(|v| v as f32)
                            .filter(|v| v.is_finite())
                    })
                    .collect();
                (channel.id.clone(), values)
            })
            .collect(),
    ))
}

pub(super) fn artifact_names(request: &PopulationSliceRequest) -> Vec<&'static str> {
    request
        .inference
        .as_ref()
        .map(|s| {
            s.method
                .descriptor()
                .channels
                .iter()
                .map(|c| c.artifact.as_str())
                .collect()
        })
        .unwrap_or_default()
}
pub(super) fn schema(request: &PopulationSliceRequest) -> &'static str {
    match request.inference.as_ref().map(|s| &s.method) {
        Some(field_table::population_inference::Method::OneSample) => {
            "brainflow.population-export.v3"
        }
        Some(_) => "brainflow.population-export.v4",
        None if request.reference.is_some() => "brainflow.population-export.v2",
        None => "brainflow.population-export.v1",
    }
}
