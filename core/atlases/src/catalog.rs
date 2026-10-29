/*!
 * Atlas Catalog - manages the database of available atlases
 */

use crate::types::*;
use anyhow::Result;
use tracing::{debug, info};

// ---------------------------------------------------------------------------
// Declarative Atlas Registry
// ---------------------------------------------------------------------------

/// Static metadata for a built-in atlas.  Runtime-mutable fields
/// (is_favorite, last_used, is_cached) live only on `AtlasCatalogEntry`.
#[derive(serde::Deserialize)]
struct AtlasRegistryEntry {
    id: String,
    name: String,
    description: String,
    category: AtlasCategory,
    /// Which space families this atlas supports
    space_families: Vec<SpaceFamily>,
    network_options: Option<Vec<u8>>,
    parcel_options: Option<Vec<u32>>,
    citation: String,
    download_size_mb: f64,
}

/// Coarse grouping of compatible template spaces.
/// `populate_builtin_atlases` expands these into concrete `SpaceInfo` vecs.
#[derive(Clone, Copy, serde::Deserialize)]
enum SpaceFamily {
    Mni152,
    FsAverage,
}

// ---------------------------------------------------------------------------
// Shared space / resolution definitions
// ---------------------------------------------------------------------------

fn mni152_spaces() -> Vec<SpaceInfo> {
    vec![
        SpaceInfo {
            id: "MNI152NLin2009cAsym".to_string(),
            name: "MNI152 (2009c Asymmetric)".to_string(),
            description: "Standard MNI152 template, asymmetric version".to_string(),
            data_type: AtlasDataType::Volume,
        },
        SpaceInfo {
            id: "MNI152NLin6Asym".to_string(),
            name: "MNI152 (6th Gen Asymmetric)".to_string(),
            description: "6th generation MNI152 template".to_string(),
            data_type: AtlasDataType::Volume,
        },
    ]
}

fn fsaverage_spaces() -> Vec<SpaceInfo> {
    vec![
        SpaceInfo {
            id: "fsaverage".to_string(),
            name: "FreeSurfer Average".to_string(),
            description: "Standard FreeSurfer average surface".to_string(),
            data_type: AtlasDataType::Surface,
        },
        SpaceInfo {
            id: "fsaverage5".to_string(),
            name: "FreeSurfer Average (5th level)".to_string(),
            description: "5th level FreeSurfer average surface".to_string(),
            data_type: AtlasDataType::Surface,
        },
        SpaceInfo {
            id: "fsaverage6".to_string(),
            name: "FreeSurfer Average (6th level)".to_string(),
            description: "6th level FreeSurfer average surface".to_string(),
            data_type: AtlasDataType::Surface,
        },
    ]
}

fn standard_resolutions() -> Vec<ResolutionInfo> {
    vec![
        ResolutionInfo {
            value: "1mm".to_string(),
            description: "1mm isotropic".to_string(),
        },
        ResolutionInfo {
            value: "2mm".to_string(),
            description: "2mm isotropic".to_string(),
        },
    ]
}

/// Expand a slice of `SpaceFamily` into concrete `SpaceInfo` entries.
fn expand_spaces(families: &[SpaceFamily]) -> Vec<SpaceInfo> {
    let mut out = Vec::new();
    for fam in families {
        match fam {
            SpaceFamily::Mni152 => out.extend(mni152_spaces()),
            SpaceFamily::FsAverage => out.extend(fsaverage_spaces()),
        }
    }
    out
}

/// Manages the catalog of available atlases
pub struct AtlasCatalog {
    entries: Vec<AtlasCatalogEntry>,
    favorites: std::collections::HashSet<String>,
}

impl Default for AtlasCatalog {
    fn default() -> Self {
        Self::new()
    }
}

impl AtlasCatalog {
    /// Create a new atlas catalog with built-in atlases
    pub fn new() -> Self {
        let mut catalog = Self {
            entries: Vec::new(),
            favorites: std::collections::HashSet::new(),
        };

        catalog.populate_builtin_atlases();
        catalog
    }

    /// Get all atlas entries, optionally filtered
    pub fn get_entries(&self, filter: Option<&AtlasFilter>) -> Vec<AtlasCatalogEntry> {
        let mut entries = self.entries.clone();

        if let Some(filter) = filter {
            entries = self.apply_filter(entries, filter);
        }

        // Sort by usage (favorites first, then recently used)
        entries.sort_by(|a, b| {
            match (a.is_favorite, b.is_favorite) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => {
                    // Both same favorite status, sort by last used
                    match (&a.last_used, &b.last_used) {
                        (Some(a_time), Some(b_time)) => b_time.cmp(a_time),
                        (Some(_), None) => std::cmp::Ordering::Less,
                        (None, Some(_)) => std::cmp::Ordering::Greater,
                        (None, None) => a.name.cmp(&b.name),
                    }
                }
            }
        });

        entries
    }

    /// Get a specific atlas entry by ID
    pub fn get_entry(&self, id: &str) -> Option<&AtlasCatalogEntry> {
        self.entries.iter().find(|e| e.id == id)
    }

    /// Toggle favorite status for an atlas
    pub fn toggle_favorite(&mut self, id: &str) -> Result<bool> {
        if let Some(entry) = self.entries.iter_mut().find(|e| e.id == id) {
            entry.is_favorite = !entry.is_favorite;

            if entry.is_favorite {
                self.favorites.insert(id.to_string());
            } else {
                self.favorites.remove(id);
            }

            info!("Toggled favorite for atlas {}: {}", id, entry.is_favorite);
            Ok(entry.is_favorite)
        } else {
            anyhow::bail!("Atlas not found: {}", id)
        }
    }

    /// Update the last used timestamp for an atlas
    pub fn mark_used(&mut self, id: &str) -> Result<()> {
        if let Some(entry) = self.entries.iter_mut().find(|e| e.id == id) {
            entry.last_used = Some(chrono::Utc::now().to_rfc3339());
            debug!("Marked atlas {} as used", id);
            Ok(())
        } else {
            anyhow::bail!("Atlas not found: {}", id)
        }
    }

    /// Get recent atlas entries (last 5 used)
    pub fn get_recent(&self) -> Vec<AtlasCatalogEntry> {
        let mut recent: Vec<_> = self
            .entries
            .iter()
            .filter(|e| e.last_used.is_some())
            .cloned()
            .collect();

        recent.sort_by(|a, b| {
            b.last_used
                .as_ref()
                .unwrap()
                .cmp(a.last_used.as_ref().unwrap())
        });

        recent.truncate(5);
        recent
    }

    /// Get favorite atlas entries
    pub fn get_favorites(&self) -> Vec<AtlasCatalogEntry> {
        self.entries
            .iter()
            .filter(|e| e.is_favorite)
            .cloned()
            .collect()
    }

    /// Check if two atlas configurations are compatible
    pub fn are_compatible(&self, atlas_id: &str, space: &str) -> bool {
        if let Some(entry) = self.get_entry(atlas_id) {
            entry.allowed_spaces.iter().any(|s| s.id == space)
        } else {
            false
        }
    }

    /// Apply filters to atlas entries
    fn apply_filter(
        &self,
        mut entries: Vec<AtlasCatalogEntry>,
        filter: &AtlasFilter,
    ) -> Vec<AtlasCatalogEntry> {
        if let Some(query) = &filter.search_query {
            let query = query.to_lowercase();
            entries.retain(|e| {
                e.name.to_lowercase().contains(&query)
                    || e.description.to_lowercase().contains(&query)
            });
        }

        if let Some(category) = &filter.category {
            entries.retain(|e| e.category == *category);
        }

        if let Some(source) = &filter.source {
            entries.retain(|e| e.source == *source);
        }

        if let Some(space) = &filter.space {
            entries.retain(|e| e.allowed_spaces.iter().any(|s| s.id == *space));
        }

        if let Some(data_type) = &filter.data_type {
            entries.retain(|e| e.allowed_spaces.iter().any(|s| s.data_type == *data_type));
        }

        if filter.show_favorites_only {
            entries.retain(|e| e.is_favorite);
        }

        if filter.show_cached_only {
            entries.retain(|e| e.is_cached);
        }

        entries
    }

    /// Populate native runtime state from the shared static registry.
    fn populate_builtin_atlases(&mut self) {
        let registry: Vec<AtlasRegistryEntry> =
            serde_json::from_str(include_str!("../registry.json"))
                .expect("embedded atlas registry must match AtlasRegistryEntry");
        for reg in registry {
            self.entries.push(AtlasCatalogEntry {
                id: reg.id.to_string(),
                name: reg.name.to_string(),
                description: reg.description.to_string(),
                source: AtlasSource::BuiltIn,
                category: reg.category.clone(),
                allowed_spaces: expand_spaces(&reg.space_families),
                resolutions: standard_resolutions(),
                network_options: reg.network_options,
                parcel_options: reg.parcel_options,
                is_favorite: false,
                last_used: None,
                citation: Some(reg.citation.to_string()),
                is_cached: false,
                download_size_mb: Some(reg.download_size_mb),
            });
        }

        info!(
            "Populated atlas catalog with {} built-in atlases",
            self.entries.len()
        );
    }
}

#[cfg(test)]
mod catalog_tests {
    use super::*;

    #[test]
    fn shared_registry_retains_variants_spaces_and_local_favorites() {
        let mut catalog = AtlasCatalog::new();
        assert_eq!(catalog.entries.len(), 4);
        let schaefer = catalog.get_entry("schaefer2018").unwrap();
        assert_eq!(
            schaefer.parcel_options.as_ref().unwrap(),
            &[100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]
        );
        assert_eq!(schaefer.network_options.as_ref().unwrap(), &[7, 17]);
        assert!(catalog.are_compatible("schaefer2018", "fsaverage"));
        assert!(catalog.are_compatible("schaefer2018", "MNI152NLin6Asym"));
        assert!(!catalog.are_compatible("olsen_mtl", "fsaverage"));
        assert!(catalog.toggle_favorite("schaefer2018").unwrap());
        assert!(
            !AtlasCatalog::new()
                .get_entry("schaefer2018")
                .unwrap()
                .is_favorite
        );
    }
}
