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
            Inputs::OnePopulation | Inputs::DesignMatrix => {
                if request.reference.is_some() {
                    return Err(input("One-sample inference requires only population A."));
                }
            }
            Inputs::IndependentGroups | Inputs::PairedGroups => {
                let reference = request.reference.as_ref().ok_or_else(|| {
                    input("Choose population B before comparing independent groups.")
                })?;
                let b = participants(&reference.aggregation)?;
                spec.validate(&b.iter().map(String::as_str).collect::<Vec<_>>())
                    .map_err(input)?;
                if matches!(spec.method.descriptor().inputs, Inputs::PairedGroups) {
                    if a.len() != b.len() || b.iter().any(|id| !a.contains(id)) {
                        return Err(input("Paired testing requires exactly the same participant IDs in A and B; resolve unmatched participants explicitly."));
                    }
                    if reference
                        .member_ids
                        .iter()
                        .any(|id| request.working_member_ids.contains(id))
                    {
                        return Err(input("Paired A and B must use distinct observations; an observation cannot be paired with itself."));
                    }
                } else if b.iter().any(|id| a.contains(id)) {
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
    cached: &CachedPlane,
    request: &PopulationSliceRequest,
    cancellation: &SampleCancellation,
    summaries: &[LocationSummary],
    reference: Option<&[LocationSummary]>,
    pixels: &[Option<usize>],
    spec: &Specification,
) -> BridgeResult<Channels> {
    let native = if matches!(spec.method.descriptor().inputs, Inputs::DesignMatrix) {
        let design = spec
            .design
            .as_ref()
            .ok_or_else(|| input("OLS design unavailable."))?;
        let aggregation = request
            .aggregation
            .as_ref()
            .ok_or_else(|| input("Participant identities unavailable."))?;
        let indices: HashMap<_, _> = cached
            .sources
            .iter()
            .enumerate()
            .map(|(i, s)| (&s.member_id, i))
            .collect();
        let mut estimates = Vec::new();
        let width = cached.plan.voxels.len().max(1);
        for first in (0..width).step_by(512) {
            cancellation.check()?;
            let last = (first + 512).min(width);
            let mut responses = Vec::new();
            for id in &design.participant_ids {
                let group = aggregation
                    .groups
                    .iter()
                    .find(|g| &g.participant_id == id)
                    .ok_or_else(|| input("OLS participant mismatch."))?;
                let rows: Vec<_> = group
                    .member_ids
                    .iter()
                    .map(|id| cached.rows[indices[id]].as_slice())
                    .collect();
                let values = (first..last)
                    .map(|j| {
                        let mut mean = 0.;
                        let mut n = 0.;
                        for row in &rows {
                            if let Some(&v) = row.get(j) {
                                if v.is_finite() {
                                    n += 1.;
                                    mean += (v as f64 - mean) / n;
                                }
                            }
                        }
                        if n > 0. {
                            mean
                        } else {
                            f64::NAN
                        }
                    })
                    .collect();
                responses.push(values);
            }
            estimates.extend(
                design
                    .evaluate(&responses, spec.null_value)
                    .map_err(input)?,
            );
        }
        estimates
    } else if matches!(spec.method.descriptor().inputs, Inputs::PairedGroups) {
        let mut paired =
            field_table::population_inference::PairedMoments::new(cached.plan.voxels.len().max(1))
                .map_err(|e| input(e.to_string()))?;
        if !cached.plan.voxels.is_empty() {
            let indices: HashMap<_, _> = cached
                .sources
                .iter()
                .enumerate()
                .map(|(i, s)| (&s.member_id, i))
                .collect();
            let a = request
                .aggregation
                .as_ref()
                .ok_or_else(|| input("Paired A identities unavailable."))?;
            let b = request
                .reference
                .as_ref()
                .and_then(|r| r.aggregation.as_ref())
                .ok_or_else(|| input("Paired B identities unavailable."))?;
            for group in &a.groups {
                cancellation.check()?;
                let matched = b
                    .groups
                    .iter()
                    .find(|g| g.participant_id == group.participant_id)
                    .ok_or_else(|| input("Unmatched participant."))?;
                let rows_a: Vec<_> = group
                    .member_ids
                    .iter()
                    .map(|id| cached.rows[indices[id]].as_slice())
                    .collect();
                let rows_b: Vec<_> = matched
                    .member_ids
                    .iter()
                    .map(|id| cached.rows[indices[id]].as_slice())
                    .collect();
                paired
                    .push(&rows_a, &rows_b)
                    .map_err(|e| input(e.to_string()))?;
            }
        }
        paired.estimates(spec.null_value).collect::<Vec<_>>()
    } else {
        summaries
            .iter()
            .enumerate()
            .map(|(i, a)| {
                spec.method
                    .evaluate(a, reference.map(|b| &b[i]), spec.null_value)
                    .map_err(input)
            })
            .collect::<BridgeResult<Vec<_>>>()?
    };
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
