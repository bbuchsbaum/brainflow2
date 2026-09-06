//! Shared built-in method contract, consumed by native validation and the UI.
use super::{Channel, FeatureRole, Method};
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Inputs {
    OnePopulation,
    DesignMatrix,
    IndependentGroups,
    PairedGroups,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChannelDescriptor {
    pub id: Channel,
    pub label: String,
    pub scale: Scale,
    pub artifact: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub initial_limit: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count_population: Option<Population>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Scale {
    Effect,
    Diverging,
    Nonnegative,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Descriptor {
    pub id: Method,
    pub version: u32,
    pub label: String,
    pub inputs: Inputs,
    pub description: String,
    pub estimand: String,
    pub limitations: String,
    pub accepted_roles: Vec<FeatureRole>,
    pub minimum_participants: usize,
    pub default_channel: Channel,
    pub channels: Vec<ChannelDescriptor>,
}
pub fn methods() -> &'static [Descriptor] {
    static CATALOG: OnceLock<Vec<Descriptor>> = OnceLock::new();
    CATALOG.get_or_init(|| {
        serde_json::from_str(include_str!("methods.json"))
            .expect("built-in statistical catalog must be valid")
    })
}
impl Method {
    pub fn descriptor(&self) -> &'static Descriptor {
        methods()
            .iter()
            .find(|d| d.id == *self)
            .expect("every compiled method must have a descriptor")
    }
}

#[derive(Debug, Deserialize, Serialize)]
pub enum Population {
    A,
    B,
}
