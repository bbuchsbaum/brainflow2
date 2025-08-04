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
    pub fn get_organized_for_menu(&self) -> HashMap<TemplateSpace, HashMap<TemplateType, Vec<TemplateCatalogEntry>>> {
        let mut organized = HashMap::new();
        
        for entry in self.entries.values() {
            let space_map = organized.entry(entry.config.space.clone()).or_insert_with(HashMap::new);
            let type_vec = space_map.entry(entry.config.template_type.clone()).or_insert_with(Vec::new);
            type_vec.push(entry.clone());
        }
        
        // Sort templates within each type by resolution
        for space_map in organized.values_mut() {
            for type_vec in space_map.values_mut() {
                type_vec.sort_by(|a, b| {
                    a.config.resolution.as_str().cmp(b.config.resolution.as_str())
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
    
    /// Populate the catalog with standard templates
    fn populate_standard_templates(&mut self) {
        // MNI152NLin2009cAsym templates
        self.add_mni_2009c_templates();
        
        // MNI152NLin6Asym templates  
        self.add_mni_6_templates();
        
        // FreeSurfer templates
        self.add_freesurfer_templates();
    }
    
    /// Add MNI152NLin2009cAsym templates
    fn add_mni_2009c_templates(&mut self) {
        let space = TemplateSpace::MNI152NLin2009cAsym;
        
        // T1w templates
        self.add_template_entry(TemplateCatalogEntry {
            id: "MNI152NLin2009cAsym_T1w_1mm".to_string(),
            config: TemplateConfig::new(TemplateType::T1w, space.clone(), TemplateResolution::MM1),
            name: "MNI152 T1w (1mm)".to_string(),
            description: "MNI152NLin2009cAsym T1-weighted template at 1mm resolution".to_string(),
            download_url: Some("https://templateflow.s3.amazonaws.com/tpl-MNI152NLin2009cAsym/tpl-MNI152NLin2009cAsym_res-01_T1w.nii.gz".to_string()),
            file_size_mb: Some(8.5),
            checksum: None,
            is_cached: false,
            last_accessed: None,
        });
        
        self.add_template_entry(TemplateCatalogEntry {
            id: "MNI152NLin2009cAsym_T1w_2mm".to_string(),
            config: TemplateConfig::new(TemplateType::T1w, space.clone(), TemplateResolution::MM2),
            name: "MNI152 T1w (2mm)".to_string(),
            description: "MNI152NLin2009cAsym T1-weighted template at 2mm resolution".to_string(),
            download_url: Some("https://templateflow.s3.amazonaws.com/tpl-MNI152NLin2009cAsym/tpl-MNI152NLin2009cAsym_res-02_T1w.nii.gz".to_string()),
            file_size_mb: Some(1.2),
            checksum: None,
            is_cached: false,
            last_accessed: None,
        });
        
        // T2w templates
        self.add_template_entry(TemplateCatalogEntry {
            id: "MNI152NLin2009cAsym_T2w_1mm".to_string(),
            config: TemplateConfig::new(TemplateType::T2w, space.clone(), TemplateResolution::MM1),
            name: "MNI152 T2w (1mm)".to_string(),
            description: "MNI152NLin2009cAsym T2-weighted template at 1mm resolution".to_string(),
            download_url: Some("https://templateflow.s3.amazonaws.com/tpl-MNI152NLin2009cAsym/tpl-MNI152NLin2009cAsym_res-01_T2w.nii.gz".to_string()),
            file_size_mb: Some(8.5),
            checksum: None,
            is_cached: false,
            last_accessed: None,
        });
        
        self.add_template_entry(TemplateCatalogEntry {
            id: "MNI152NLin2009cAsym_T2w_2mm".to_string(),
            config: TemplateConfig::new(TemplateType::T2w, space.clone(), TemplateResolution::MM2),
            name: "MNI152 T2w (2mm)".to_string(),
            description: "MNI152NLin2009cAsym T2-weighted template at 2mm resolution".to_string(),
            download_url: Some("https://templateflow.s3.amazonaws.com/tpl-MNI152NLin2009cAsym/tpl-MNI152NLin2009cAsym_res-02_T2w.nii.gz".to_string()),
            file_size_mb: Some(1.2),
            checksum: None,
            is_cached: false,
            last_accessed: None,
        });
        
        // Tissue probability maps
        self.add_template_entry(TemplateCatalogEntry {
            id: "MNI152NLin2009cAsym_GM_1mm".to_string(),
            config: TemplateConfig::new(TemplateType::GrayMatter, space.clone(), TemplateResolution::MM1),
            name: "MNI152 Gray Matter (1mm)".to_string(),
            description: "MNI152NLin2009cAsym gray matter probability map at 1mm resolution".to_string(),
            download_url: Some("https://templateflow.s3.amazonaws.com/tpl-MNI152NLin2009cAsym/tpl-MNI152NLin2009cAsym_res-01_label-GM_probseg.nii.gz".to_string()),
            file_size_mb: Some(8.5),
            checksum: None,
            is_cached: false,
            last_accessed: None,
        });
        
        self.add_template_entry(TemplateCatalogEntry {
            id: "MNI152NLin2009cAsym_WM_1mm".to_string(),
            config: TemplateConfig::new(TemplateType::WhiteMatter, space.clone(), TemplateResolution::MM1),
            name: "MNI152 White Matter (1mm)".to_string(),
            description: "MNI152NLin2009cAsym white matter probability map at 1mm resolution".to_string(),
            download_url: Some("https://templateflow.s3.amazonaws.com/tpl-MNI152NLin2009cAsym/tpl-MNI152NLin2009cAsym_res-01_label-WM_probseg.nii.gz".to_string()),
            file_size_mb: Some(8.5),
            checksum: None,
            is_cached: false,
            last_accessed: None,
        });
        
        self.add_template_entry(TemplateCatalogEntry {
            id: "MNI152NLin2009cAsym_CSF_1mm".to_string(),
            config: TemplateConfig::new(TemplateType::Csf, space.clone(), TemplateResolution::MM1),
            name: "MNI152 CSF (1mm)".to_string(),
            description: "MNI152NLin2009cAsym CSF probability map at 1mm resolution".to_string(),
            download_url: Some("https://templateflow.s3.amazonaws.com/tpl-MNI152NLin2009cAsym/tpl-MNI152NLin2009cAsym_res-01_label-CSF_probseg.nii.gz".to_string()),
            file_size_mb: Some(8.5),
            checksum: None,
            is_cached: false,
            last_accessed: None,
        });
        
        // Brain mask
        self.add_template_entry(TemplateCatalogEntry {
            id: "MNI152NLin2009cAsym_mask_1mm".to_string(),
            config: TemplateConfig::new(TemplateType::BrainMask, space.clone(), TemplateResolution::MM1),
            name: "MNI152 Brain Mask (1mm)".to_string(),
            description: "MNI152NLin2009cAsym brain mask at 1mm resolution".to_string(),
            download_url: Some("https://templateflow.s3.amazonaws.com/tpl-MNI152NLin2009cAsym/tpl-MNI152NLin2009cAsym_res-01_desc-brain_mask.nii.gz".to_string()),
            file_size_mb: Some(0.3),
            checksum: None,
            is_cached: false,
            last_accessed: None,
        });
        
        self.add_template_entry(TemplateCatalogEntry {
            id: "MNI152NLin2009cAsym_mask_2mm".to_string(),
            config: TemplateConfig::new(TemplateType::BrainMask, space, TemplateResolution::MM2),
            name: "MNI152 Brain Mask (2mm)".to_string(),
            description: "MNI152NLin2009cAsym brain mask at 2mm resolution".to_string(),
            download_url: Some("https://templateflow.s3.amazonaws.com/tpl-MNI152NLin2009cAsym/tpl-MNI152NLin2009cAsym_res-02_desc-brain_mask.nii.gz".to_string()),
            file_size_mb: Some(0.1),
            checksum: None,
            is_cached: false,
            last_accessed: None,
        });
    }
    
    /// Add MNI152NLin6Asym templates
    fn add_mni_6_templates(&mut self) {
        let space = TemplateSpace::MNI152NLin6Asym;
        
        // Add key MNI6 templates
        self.add_template_entry(TemplateCatalogEntry {
            id: "MNI152NLin6Asym_T1w_1mm".to_string(),
            config: TemplateConfig::new(TemplateType::T1w, space.clone(), TemplateResolution::MM1),
            name: "MNI152 6th Gen T1w (1mm)".to_string(),
            description: "MNI152NLin6Asym T1-weighted template at 1mm resolution".to_string(),
            download_url: Some("https://templateflow.s3.amazonaws.com/tpl-MNI152NLin6Asym/tpl-MNI152NLin6Asym_res-01_T1w.nii.gz".to_string()),
            file_size_mb: Some(8.5),
            checksum: None,
            is_cached: false,
            last_accessed: None,
        });
        
        self.add_template_entry(TemplateCatalogEntry {
            id: "MNI152NLin6Asym_T1w_2mm".to_string(),
            config: TemplateConfig::new(TemplateType::T1w, space, TemplateResolution::MM2),
            name: "MNI152 6th Gen T1w (2mm)".to_string(),
            description: "MNI152NLin6Asym T1-weighted template at 2mm resolution".to_string(),
            download_url: Some("https://templateflow.s3.amazonaws.com/tpl-MNI152NLin6Asym/tpl-MNI152NLin6Asym_res-02_T1w.nii.gz".to_string()),
            file_size_mb: Some(1.2),
            checksum: None,
            is_cached: false,
            last_accessed: None,
        });
    }
    
    /// Add FreeSurfer surface templates
    fn add_freesurfer_templates(&mut self) {
        // FreeSurfer templates would be surface-based and require different handling
        // For now, we'll focus on volume templates
        
        // Note: Surface templates would need different download URLs and handling
        // They would typically be mesh files (.gii, .surf, etc.) rather than volumes
    }
    
    /// Add a template entry to the catalog
    fn add_template_entry(&mut self, entry: TemplateCatalogEntry) {
        self.entries.insert(entry.id.clone(), entry);
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
        ]
    }
    
    /// Get template types available in a given space
    pub fn get_types_for_space(&self, space: &TemplateSpace) -> Vec<TemplateType> {
        let mut types: Vec<TemplateType> = self.entries
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
        template_type: &TemplateType
    ) -> Vec<TemplateResolution> {
        let mut resolutions: Vec<TemplateResolution> = self.entries
            .values()
            .filter(|entry| &entry.config.space == space && &entry.config.template_type == template_type)
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