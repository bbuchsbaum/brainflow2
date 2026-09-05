//! Immutable dictionary captured from the concrete atlas that was loaded.
use neuroatlas::{Atlas, Label};

#[derive(Debug, Clone)]
pub struct ParcelDictionary {
    pub name: String,
    pub labels: Vec<Label>,
    pub full_labels: Option<Vec<String>>,
}

impl ParcelDictionary {
    pub fn from_atlas<A: Atlas>(atlas: &A) -> Self {
        Self {
            name: atlas.name().to_owned(),
            labels: atlas.labels().to_vec(),
            full_labels: atlas.orig_labels().map(<[String]>::to_vec),
        }
    }
}

impl Atlas for ParcelDictionary {
    fn name(&self) -> &str {
        &self.name
    }
    fn labels(&self) -> &[Label] {
        &self.labels
    }
    fn orig_labels(&self) -> Option<&[String]> {
        self.full_labels.as_deref()
    }
    fn get_roi(&self, _: &str) -> neuroatlas::Result<neuroatlas::ROI> {
        Err(neuroatlas::NeuroAtlasError::AtlasNotLoaded)
    }
}
