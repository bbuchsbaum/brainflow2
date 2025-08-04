/*!
 * Atlas Catalog - manages the database of available atlases
 */

use crate::types::*;
use anyhow::Result;
use std::collections::HashMap;
use tracing::{debug, info};

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
        let mut recent: Vec<_> = self.entries
            .iter()
            .filter(|e| e.last_used.is_some())
            .cloned()
            .collect();
        
        recent.sort_by(|a, b| {
            b.last_used.as_ref().unwrap().cmp(a.last_used.as_ref().unwrap())
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
    fn apply_filter(&self, mut entries: Vec<AtlasCatalogEntry>, filter: &AtlasFilter) -> Vec<AtlasCatalogEntry> {
        if let Some(query) = &filter.search_query {
            let query = query.to_lowercase();
            entries.retain(|e| {
                e.name.to_lowercase().contains(&query) ||
                e.description.to_lowercase().contains(&query)
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
            entries.retain(|e| {
                e.allowed_spaces.iter().any(|s| s.data_type == *data_type)
            });
        }

        if filter.show_favorites_only {
            entries.retain(|e| e.is_favorite);
        }

        if filter.show_cached_only {
            entries.retain(|e| e.is_cached);
        }

        entries
    }

    /// Populate the catalog with built-in atlases
    fn populate_builtin_atlases(&mut self) {
        // MNI152 spaces
        let mni152_spaces = vec![
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
        ];

        // FreeSurfer surface spaces
        let fsaverage_spaces = vec![
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
        ];

        // Standard resolutions
        let standard_resolutions = vec![
            ResolutionInfo {
                value: "1mm".to_string(),
                description: "1mm isotropic".to_string(),
            },
            ResolutionInfo {
                value: "2mm".to_string(),
                description: "2mm isotropic".to_string(),
            },
        ];

        // Schaefer Atlas
        self.entries.push(AtlasCatalogEntry {
            id: "schaefer2018".to_string(),
            name: "Schaefer 2018".to_string(),
            description: "Cortical parcellations based on connectivity gradients".to_string(),
            source: AtlasSource::BuiltIn,
            category: AtlasCategory::Cortical,
            allowed_spaces: [mni152_spaces.clone(), fsaverage_spaces.clone()].concat(),
            resolutions: standard_resolutions.clone(),
            network_options: Some(vec![7, 17]),
            parcel_options: Some(vec![100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]),
            is_favorite: false,
            last_used: None,
            citation: Some("Schaefer et al. (2018). Local-Global Parcellation of the Human Cerebral Cortex. Cerebral Cortex.".to_string()),
            is_cached: false,
            download_size_mb: Some(15.0),
        });

        // Glasser Atlas
        self.entries.push(AtlasCatalogEntry {
            id: "glasser2016".to_string(),
            name: "Glasser 2016 (HCP-MMP1.0)".to_string(),
            description: "Human Connectome Project Multi-Modal Parcellation (360 areas)".to_string(),
            source: AtlasSource::BuiltIn,
            category: AtlasCategory::Cortical,
            allowed_spaces: [mni152_spaces.clone(), fsaverage_spaces.clone()].concat(),
            resolutions: standard_resolutions.clone(),
            network_options: None,
            parcel_options: None,
            is_favorite: false,
            last_used: None,
            citation: Some("Glasser et al. (2016). A multi-modal parcellation of human cerebral cortex. Nature.".to_string()),
            is_cached: false,
            download_size_mb: Some(8.0),
        });

        // FreeSurfer ASEG
        self.entries.push(AtlasCatalogEntry {
            id: "freesurfer_aseg".to_string(),
            name: "FreeSurfer ASEG".to_string(),
            description: "Automated subcortical segmentation".to_string(),
            source: AtlasSource::BuiltIn,
            category: AtlasCategory::Subcortical,
            allowed_spaces: mni152_spaces.clone(),
            resolutions: standard_resolutions.clone(),
            network_options: None,
            parcel_options: None,
            is_favorite: false,
            last_used: None,
            citation: Some("Fischl et al. (2002). Whole brain segmentation. Neuron.".to_string()),
            is_cached: false,
            download_size_mb: Some(5.0),
        });

        // Olsen MTL
        self.entries.push(AtlasCatalogEntry {
            id: "olsen_mtl".to_string(),
            name: "Olsen MTL".to_string(),
            description: "High-resolution medial temporal lobe parcellation".to_string(),
            source: AtlasSource::BuiltIn,
            category: AtlasCategory::Specialized,
            allowed_spaces: mni152_spaces.clone(),
            resolutions: standard_resolutions.clone(),
            network_options: None,
            parcel_options: None,
            is_favorite: false,
            last_used: None,
            citation: Some("Olsen et al. MTL parcellation atlas.".to_string()),
            is_cached: false,
            download_size_mb: Some(3.0),
        });

        info!("Populated atlas catalog with {} built-in atlases", self.entries.len());
    }
}