/*!
 * Template Catalog - Predefined template configurations
 */

use crate::types::*;
use std::collections::HashMap;

/// Manages the catalog of available templates
pub struct TemplateCatalog {
    entries: HashMap<String, TemplateCatalogEntry>,
}

impl TemplateCatalog {
    /// Create a new template catalog with predefined entries
    pub fn new() -> Self {
        let mut catalog = Self {
            entries: HashMap::new(),
        };

        catalog.populate_standard_templates();
        catalog
    }

    /// Get all template entries
    pub fn get_all(&self) -> Vec<TemplateCatalogEntry> {
        self.entries.values().cloned().collect()
    }

    /// Get a specific template entry by ID
    pub fn get_by_id(&self, id: &str) -> Option<&TemplateCatalogEntry> {
        self.entries.get(id)
    }

    /// Get templates filtered by criteria
    pub fn get_filtered(&self, filter: &TemplateFilter) -> Vec<TemplateCatalogEntry> {
        self.entries
            .values()
            .filter(|entry| self.matches_filter(entry, filter))
            .cloned()
            .collect()
    }

    /// Get templates organized by space and type for menu building
    pub fn get_organized_for_menu(
        &self,
    ) -> HashMap<TemplateSpace, HashMap<TemplateType, Vec<TemplateCatalogEntry>>> {
        let mut organized = HashMap::new();

        for entry in self.entries.values() {
            let space_map = organized
                .entry(entry.config.space.clone())
                .or_insert_with(HashMap::new);
            let type_vec = space_map
                .entry(entry.config.template_type.clone())
                .or_insert_with(Vec::new);
            type_vec.push(entry.clone());
        }

        // Sort templates within each type by resolution
        for space_map in organized.values_mut() {
            for type_vec in space_map.values_mut() {
                type_vec.sort_by(|a, b| {
                    a.config
                        .resolution
                        .as_str()
                        .cmp(b.config.resolution.as_str())
                });
            }
        }

        organized
    }

    /// Check if a template entry matches the filter criteria
    fn matches_filter(&self, entry: &TemplateCatalogEntry, filter: &TemplateFilter) -> bool {
        if let Some(template_type) = &filter.template_type {
            if &entry.config.template_type != template_type {
                return false;
            }
        }

        if let Some(space) = &filter.space {
            if &entry.config.space != space {
                return false;
            }
        }

        if let Some(resolution) = &filter.resolution {
            if &entry.config.resolution != resolution {
                return false;
            }
        }

        if filter.show_cached_only && !entry.is_cached {
            return false;
        }

        true
    }

    /// Static definitions are shared with browser hosts; cache state stays local.
    fn populate_standard_templates(&mut self) {
        let entries: Vec<TemplateCatalogEntry> =
            serde_json::from_str(include_str!("../catalog.json"))
                .expect("embedded template catalog must match TemplateCatalogEntry");
        self.entries = entries
            .into_iter()
            .map(|entry| (entry.id.clone(), entry))
            .collect();
    }

    /// Mark a template as cached
    pub fn mark_as_cached(&mut self, template_id: &str) {
        if let Some(entry) = self.entries.get_mut(template_id) {
            entry.is_cached = true;
            entry.last_accessed = Some(chrono::Utc::now().to_rfc3339());
        }
    }

    /// Update last accessed time for a template
    pub fn update_last_accessed(&mut self, template_id: &str) {
        if let Some(entry) = self.entries.get_mut(template_id) {
            entry.last_accessed = Some(chrono::Utc::now().to_rfc3339());
        }
    }

    /// Get templates organized by space for menu construction
    pub fn get_volume_spaces(&self) -> Vec<TemplateSpace> {
        vec![
            TemplateSpace::MNI152NLin2009cAsym,
            TemplateSpace::MNI152NLin6Asym,
            TemplateSpace::MNIColin27,
            TemplateSpace::MNI305,
        ]
    }

    /// Get template types available in a given space
    pub fn get_types_for_space(&self, space: &TemplateSpace) -> Vec<TemplateType> {
        let mut types: Vec<TemplateType> = self
            .entries
            .values()
            .filter(|entry| &entry.config.space == space)
            .map(|entry| entry.config.template_type.clone())
            .collect();

        types.sort_by_key(|t| t.as_str());
        types.dedup();
        types
    }

    /// Get resolutions available for a given space and type
    pub fn get_resolutions_for_space_and_type(
        &self,
        space: &TemplateSpace,
        template_type: &TemplateType,
    ) -> Vec<TemplateResolution> {
        let mut resolutions: Vec<TemplateResolution> = self
            .entries
            .values()
            .filter(|entry| {
                &entry.config.space == space && &entry.config.template_type == template_type
            })
            .map(|entry| entry.config.resolution.clone())
            .collect();

        resolutions.sort_by_key(|r| r.as_str());
        resolutions.dedup();
        resolutions
    }
}

impl Default for TemplateCatalog {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod catalog_tests {
    use super::*;

    #[test]
    fn shared_definitions_preserve_template_identity_and_local_cache_state() {
        let mut catalog = TemplateCatalog::new();
        let entries = catalog.get_all();
        assert_eq!(entries.len(), 16);
        for entry in &entries {
            assert_eq!(entry.id, entry.config.id());
            assert!(!entry.is_cached);
            assert!(entry.last_accessed.is_none());
            assert!(entry.download_url.as_ref().unwrap().starts_with("https://"));
        }
        let id = "MNI152NLin2009cAsym_T1w_2mm";
        catalog.mark_as_cached(id);
        assert!(catalog.get_by_id(id).unwrap().is_cached);
        assert!(!TemplateCatalog::new().get_by_id(id).unwrap().is_cached);
        assert_eq!(
            catalog
                .get_types_for_space(&TemplateSpace::MNI152NLin2009cAsym)
                .len(),
            6
        );
    }
}
