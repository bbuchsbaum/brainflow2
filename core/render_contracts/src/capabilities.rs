//! Named renderer features. Advertise a feature only after its implementation
//! and native/GPU acceptance tests exist; clients fail closed on absence.
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum RenderFeature {
    EditableLabels,
    SubRegionUpload,
    MultiOutline,
    ZoomPan,
    NativePlanes,
    ObliquePlanes,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct RenderCapabilities {
    pub features: Vec<RenderFeature>,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn capability_wire_names_and_round_trip() {
        let value = RenderCapabilities {
            features: vec![RenderFeature::SubRegionUpload, RenderFeature::ObliquePlanes],
        };
        let json = serde_json::to_string(&value).unwrap();
        assert_eq!(json, r#"{"features":["subRegionUpload","obliquePlanes"]}"#);
        assert_eq!(
            serde_json::from_str::<RenderCapabilities>(&json).unwrap(),
            value
        );
        assert!(RenderCapabilities::default().features.is_empty());
    }
}
