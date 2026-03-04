/*!
 * Menu Builder - Dynamic menu generation from catalog data
 *
 * This module provides functions to build menus from template and atlas catalogs,
 * replacing hardcoded menu construction with data-driven generation.
 */

use tauri::menu::{MenuItemBuilder, SubmenuBuilder};
use tauri::{App, Wry};

// ============================================================================
// Template Presets
// ============================================================================

/// Template preset configuration for menu items
#[derive(Debug, Clone)]
pub struct TemplatePreset {
    /// Menu ID (e.g., "template_MNI152NLin2009cAsym_T1w_1mm")
    pub menu_id: String,
    /// Display label (e.g., "T1 1mm")
    pub label: String,
    /// Template space (e.g., "MNI152NLin2009cAsym")
    pub space: String,
    /// Template type (e.g., "T1w", "GM", "mask")
    pub template_type: String,
    /// Resolution (e.g., "1mm", "2mm", "native")
    pub resolution: String,
    /// Category for menu organization
    pub category: TemplateCategory,
}

#[derive(Debug, Clone, PartialEq)]
pub enum TemplateCategory {
    Anatomical,        // T1w, T2w
    TissueProbability, // GM, WM, CSF
    BrainMask,         // mask, brain
}

impl TemplatePreset {
    pub fn new(
        space: &str,
        template_type: &str,
        resolution: &str,
        label: &str,
        category: TemplateCategory,
    ) -> Self {
        let menu_id = format!("template_{}_{}_{}", space, template_type, resolution);
        Self {
            menu_id,
            label: label.to_string(),
            space: space.to_string(),
            template_type: template_type.to_string(),
            resolution: resolution.to_string(),
            category,
        }
    }

    /// Generate JSON payload for this template preset
    pub fn to_payload(&self) -> serde_json::Value {
        serde_json::json!({
            "template_id": format!("{}_{}_{}", self.space, self.template_type, self.resolution),
            "space": self.space,
            "template_type": self.template_type,
            "resolution": self.resolution,
        })
    }
}

/// Get MNI152NLin2009cAsym template presets
pub fn get_mni152_2009c_presets() -> Vec<TemplatePreset> {
    let space = "MNI152NLin2009cAsym";
    vec![
        // Anatomical
        TemplatePreset::new(space, "T1w", "1mm", "T1 1mm", TemplateCategory::Anatomical),
        TemplatePreset::new(space, "T1w", "2mm", "T1 2mm", TemplateCategory::Anatomical),
        TemplatePreset::new(space, "T2w", "1mm", "T2 1mm", TemplateCategory::Anatomical),
        TemplatePreset::new(space, "T2w", "2mm", "T2 2mm", TemplateCategory::Anatomical),
        // Tissue Probability
        TemplatePreset::new(
            space,
            "GM",
            "1mm",
            "Gray Matter (1mm)",
            TemplateCategory::TissueProbability,
        ),
        TemplatePreset::new(
            space,
            "GM",
            "2mm",
            "Gray Matter (2mm)",
            TemplateCategory::TissueProbability,
        ),
        TemplatePreset::new(
            space,
            "WM",
            "1mm",
            "White Matter (1mm)",
            TemplateCategory::TissueProbability,
        ),
        TemplatePreset::new(
            space,
            "WM",
            "2mm",
            "White Matter (2mm)",
            TemplateCategory::TissueProbability,
        ),
        TemplatePreset::new(
            space,
            "CSF",
            "1mm",
            "CSF (1mm)",
            TemplateCategory::TissueProbability,
        ),
        TemplatePreset::new(
            space,
            "CSF",
            "2mm",
            "CSF (2mm)",
            TemplateCategory::TissueProbability,
        ),
        // Brain Masks
        TemplatePreset::new(
            space,
            "mask",
            "1mm",
            "Brain Mask (1mm)",
            TemplateCategory::BrainMask,
        ),
        TemplatePreset::new(
            space,
            "mask",
            "2mm",
            "Brain Mask (2mm)",
            TemplateCategory::BrainMask,
        ),
        TemplatePreset::new(
            space,
            "brain",
            "1mm",
            "Skull-stripped Brain (1mm)",
            TemplateCategory::BrainMask,
        ),
        TemplatePreset::new(
            space,
            "brain",
            "2mm",
            "Skull-stripped Brain (2mm)",
            TemplateCategory::BrainMask,
        ),
    ]
}

/// Get MNIColin27 template presets
pub fn get_mnicolin27_presets() -> Vec<TemplatePreset> {
    let space = "MNIColin27";
    vec![
        TemplatePreset::new(space, "T1w", "native", "T1w", TemplateCategory::Anatomical),
        TemplatePreset::new(
            space,
            "mask",
            "native",
            "Brain Mask",
            TemplateCategory::BrainMask,
        ),
    ]
}

/// Get MNI305 template presets
pub fn get_mni305_presets() -> Vec<TemplatePreset> {
    let space = "MNI305";
    vec![
        TemplatePreset::new(space, "T1w", "native", "T1w", TemplateCategory::Anatomical),
        TemplatePreset::new(space, "T2w", "native", "T2w", TemplateCategory::Anatomical),
        TemplatePreset::new(
            space,
            "mask",
            "native",
            "Brain Mask",
            TemplateCategory::BrainMask,
        ),
    ]
}

/// Get all template presets
pub fn get_all_template_presets() -> Vec<TemplatePreset> {
    let mut all = Vec::new();
    all.extend(get_mni152_2009c_presets());
    all.extend(get_mnicolin27_presets());
    all.extend(get_mni305_presets());
    all
}

/// Find a template preset by menu ID
pub fn find_template_preset_by_menu_id(menu_id: &str) -> Option<TemplatePreset> {
    get_all_template_presets()
        .into_iter()
        .find(|p| p.menu_id == menu_id)
}

/// Build the Templates menu
pub fn build_templates_menu(app: &App<Wry>) -> Result<tauri::menu::Submenu<Wry>, tauri::Error> {
    let mut templates_menu = SubmenuBuilder::new(app, "Templates");

    // MNI152 2009c Asymmetric
    let mni152_presets = get_mni152_2009c_presets();
    let mut mni152_menu = SubmenuBuilder::new(app, "MNI152 2009c Asymmetric");

    // Add anatomical templates directly
    for preset in mni152_presets
        .iter()
        .filter(|p| p.category == TemplateCategory::Anatomical)
    {
        mni152_menu = mni152_menu.item(
            &MenuItemBuilder::new(&preset.label)
                .id(&preset.menu_id)
                .build(app)?,
        );
    }

    mni152_menu = mni152_menu.separator();

    // Tissue Probability submenu
    let mut tissue_menu = SubmenuBuilder::new(app, "Tissue Probability");
    for preset in mni152_presets
        .iter()
        .filter(|p| p.category == TemplateCategory::TissueProbability)
    {
        tissue_menu = tissue_menu.item(
            &MenuItemBuilder::new(&preset.label)
                .id(&preset.menu_id)
                .build(app)?,
        );
    }
    mni152_menu = mni152_menu.item(&tissue_menu.build()?);

    mni152_menu = mni152_menu.separator();

    // Brain Masks submenu
    let mut mask_menu = SubmenuBuilder::new(app, "Brain Masks");
    for preset in mni152_presets
        .iter()
        .filter(|p| p.category == TemplateCategory::BrainMask)
    {
        mask_menu = mask_menu.item(
            &MenuItemBuilder::new(&preset.label)
                .id(&preset.menu_id)
                .build(app)?,
        );
    }
    mni152_menu = mni152_menu.item(&mask_menu.build()?);

    templates_menu = templates_menu.item(&mni152_menu.build()?);

    // MNI Colin27
    let colin27_presets = get_mnicolin27_presets();
    let mut colin27_menu = SubmenuBuilder::new(app, "MNI Colin27");
    for preset in &colin27_presets {
        colin27_menu = colin27_menu.item(
            &MenuItemBuilder::new(&preset.label)
                .id(&preset.menu_id)
                .build(app)?,
        );
    }
    templates_menu = templates_menu.item(&colin27_menu.build()?);

    // MNI305
    let mni305_presets = get_mni305_presets();
    let mut mni305_menu = SubmenuBuilder::new(app, "MNI305");
    for preset in &mni305_presets {
        mni305_menu = mni305_menu.item(
            &MenuItemBuilder::new(&preset.label)
                .id(&preset.menu_id)
                .build(app)?,
        );
    }
    templates_menu = templates_menu.item(&mni305_menu.build()?);

    templates_menu.build()
}

// ============================================================================
// Atlas Presets
// ============================================================================

/// Atlas preset configuration for menu items
#[derive(Debug, Clone)]
pub struct AtlasPreset {
    pub menu_id: String,
    pub label: String,
    pub atlas_id: String,
    pub space: String,
    pub resolution: String,
    pub networks: Option<u8>,
    pub parcels: Option<u32>,
}

impl AtlasPreset {
    pub fn new(menu_id: &str, label: &str, atlas_id: &str, space: &str, resolution: &str) -> Self {
        Self {
            menu_id: menu_id.to_string(),
            label: label.to_string(),
            atlas_id: atlas_id.to_string(),
            space: space.to_string(),
            resolution: resolution.to_string(),
            networks: None,
            parcels: None,
        }
    }

    pub fn with_schaefer_params(mut self, parcels: u32, networks: u8) -> Self {
        self.parcels = Some(parcels);
        self.networks = Some(networks);
        self
    }

    /// Generate JSON payload for this preset
    pub fn to_payload(&self) -> serde_json::Value {
        let mut payload = serde_json::json!({
            "atlas_id": self.atlas_id,
            "space": self.space,
            "resolution": self.resolution,
        });

        if let Some(networks) = self.networks {
            payload["networks"] = serde_json::json!(networks);
        }
        if let Some(parcels) = self.parcels {
            payload["parcels"] = serde_json::json!(parcels);
        }

        payload
    }
}

/// Get all Schaefer 2018 atlas presets
pub fn get_schaefer_presets() -> Vec<AtlasPreset> {
    let parcel_options = [100, 200, 400, 600, 1000];
    let network_options = [7, 17];

    let mut presets = Vec::new();

    for &networks in &network_options {
        for &parcels in &parcel_options {
            let menu_id = format!("atlas_schaefer2018_{}_{}", parcels, networks);
            let label = format!("{} parcels / {} networks", parcels, networks);

            presets.push(
                AtlasPreset::new(
                    &menu_id,
                    &label,
                    "schaefer2018",
                    "MNI152NLin2009cAsym",
                    "1mm",
                )
                .with_schaefer_params(parcels, networks),
            );
        }
    }

    presets
}

/// Get Glasser 2016 atlas presets
pub fn get_glasser_presets() -> Vec<AtlasPreset> {
    vec![
        AtlasPreset::new(
            "atlas_glasser2016_1mm",
            "Glasser 360 (1mm)",
            "glasser2016",
            "MNI152NLin2009cAsym",
            "1mm",
        ),
        AtlasPreset::new(
            "atlas_glasser2016_2mm",
            "Glasser 360 (2mm)",
            "glasser2016",
            "MNI152NLin2009cAsym",
            "2mm",
        ),
    ]
}

/// Get FreeSurfer ASEG atlas presets
pub fn get_aseg_presets() -> Vec<AtlasPreset> {
    vec![
        AtlasPreset::new(
            "atlas_freesurfer_aseg_1mm",
            "ASEG Subcortical (1mm)",
            "freesurfer_aseg",
            "MNI152NLin2009cAsym",
            "1mm",
        ),
        AtlasPreset::new(
            "atlas_freesurfer_aseg_2mm",
            "ASEG Subcortical (2mm)",
            "freesurfer_aseg",
            "MNI152NLin2009cAsym",
            "2mm",
        ),
    ]
}

/// Get Olsen MTL atlas presets
pub fn get_olsen_mtl_presets() -> Vec<AtlasPreset> {
    vec![AtlasPreset::new(
        "atlas_olsen_mtl_1mm",
        "Olsen MTL (1mm)",
        "olsen_mtl",
        "MNI152NLin2009cAsym",
        "1mm",
    )]
}

/// Get Hippocampus atlas presets
pub fn get_hippocampus_presets() -> Vec<AtlasPreset> {
    vec![AtlasPreset::new(
        "atlas_hippocampus_1mm",
        "Hippocampus Subfields (1mm)",
        "hippocampus",
        "MNI152NLin2009cAsym",
        "1mm",
    )]
}

/// Get CIT168 subcortical atlas presets
pub fn get_cit168_presets() -> Vec<AtlasPreset> {
    vec![AtlasPreset::new(
        "atlas_cit168_1mm",
        "CIT168 Subcortex (1mm)",
        "cit168",
        "MNI152NLin2009cAsym",
        "1mm",
    )]
}

/// Get HCP Thalamus atlas presets
pub fn get_hcp_thalamus_presets() -> Vec<AtlasPreset> {
    vec![AtlasPreset::new(
        "atlas_hcp_thalamus_1mm",
        "HCP Thalamic Nuclei (1mm)",
        "hcp_thalamus",
        "MNI152NLin2009cAsym",
        "1mm",
    )]
}

/// Get MDTB10 Cerebellum atlas presets
pub fn get_mdtb10_presets() -> Vec<AtlasPreset> {
    vec![AtlasPreset::new(
        "atlas_mdtb10_1mm",
        "MDTB10 Cerebellum (1mm)",
        "mdtb10",
        "MNI152NLin2009cAsym",
        "1mm",
    )]
}

/// Get HCP Hippocampus/Amygdala atlas presets
pub fn get_hcp_hippamyg_presets() -> Vec<AtlasPreset> {
    vec![AtlasPreset::new(
        "atlas_hcp_hippamyg_1mm",
        "HCP Hipp/Amyg (1mm)",
        "hcp_hippamyg",
        "MNI152NLin2009cAsym",
        "1mm",
    )]
}

/// Get all atlas presets organized by category
pub fn get_all_presets() -> Vec<AtlasPreset> {
    let mut all = Vec::new();
    all.extend(get_schaefer_presets());
    all.extend(get_glasser_presets());
    all.extend(get_aseg_presets());
    all.extend(get_olsen_mtl_presets());
    all.extend(get_hippocampus_presets());
    all.extend(get_cit168_presets());
    all.extend(get_hcp_thalamus_presets());
    all.extend(get_mdtb10_presets());
    all.extend(get_hcp_hippamyg_presets());
    all
}

/// Find an atlas preset by menu ID
pub fn find_preset_by_menu_id(menu_id: &str) -> Option<AtlasPreset> {
    get_all_presets().into_iter().find(|p| p.menu_id == menu_id)
}

/// Build the Atlases menu with all available atlas presets
pub fn build_atlases_menu(app: &App<Wry>) -> Result<tauri::menu::Submenu<Wry>, tauri::Error> {
    // Cortical Atlases submenu
    let mut cortical_menu = SubmenuBuilder::new(app, "Cortical");

    // Schaefer 2018 submenu
    let mut schaefer_menu = SubmenuBuilder::new(app, "Schaefer 2018");

    // 7 Networks group
    let mut schaefer_7_menu = SubmenuBuilder::new(app, "7 Networks");
    for preset in get_schaefer_presets()
        .iter()
        .filter(|p| p.networks == Some(7))
    {
        schaefer_7_menu = schaefer_7_menu.item(
            &MenuItemBuilder::new(&preset.label)
                .id(&preset.menu_id)
                .build(app)?,
        );
    }

    // 17 Networks group
    let mut schaefer_17_menu = SubmenuBuilder::new(app, "17 Networks");
    for preset in get_schaefer_presets()
        .iter()
        .filter(|p| p.networks == Some(17))
    {
        schaefer_17_menu = schaefer_17_menu.item(
            &MenuItemBuilder::new(&preset.label)
                .id(&preset.menu_id)
                .build(app)?,
        );
    }

    schaefer_menu = schaefer_menu
        .item(&schaefer_7_menu.build()?)
        .item(&schaefer_17_menu.build()?);

    // Glasser 2016 submenu
    let mut glasser_menu = SubmenuBuilder::new(app, "Glasser 2016 (HCP-MMP1.0)");
    for preset in get_glasser_presets() {
        glasser_menu = glasser_menu.item(
            &MenuItemBuilder::new(&preset.label)
                .id(&preset.menu_id)
                .build(app)?,
        );
    }

    cortical_menu = cortical_menu
        .item(&schaefer_menu.build()?)
        .item(&glasser_menu.build()?);

    // Subcortical Atlases submenu
    let mut subcortical_menu = SubmenuBuilder::new(app, "Subcortical");

    // ASEG
    let mut aseg_menu = SubmenuBuilder::new(app, "FreeSurfer ASEG");
    for preset in get_aseg_presets() {
        aseg_menu = aseg_menu.item(
            &MenuItemBuilder::new(&preset.label)
                .id(&preset.menu_id)
                .build(app)?,
        );
    }

    // CIT168
    let mut cit168_menu = SubmenuBuilder::new(app, "CIT168 Subcortex");
    for preset in get_cit168_presets() {
        cit168_menu = cit168_menu.item(
            &MenuItemBuilder::new(&preset.label)
                .id(&preset.menu_id)
                .build(app)?,
        );
    }

    // HCP Thalamus
    let mut hcp_thalamus_menu = SubmenuBuilder::new(app, "HCP Thalamic Nuclei");
    for preset in get_hcp_thalamus_presets() {
        hcp_thalamus_menu = hcp_thalamus_menu.item(
            &MenuItemBuilder::new(&preset.label)
                .id(&preset.menu_id)
                .build(app)?,
        );
    }

    // HCP Hippocampus/Amygdala
    let mut hcp_hippamyg_menu = SubmenuBuilder::new(app, "HCP Hippocampus/Amygdala");
    for preset in get_hcp_hippamyg_presets() {
        hcp_hippamyg_menu = hcp_hippamyg_menu.item(
            &MenuItemBuilder::new(&preset.label)
                .id(&preset.menu_id)
                .build(app)?,
        );
    }

    subcortical_menu = subcortical_menu
        .item(&aseg_menu.build()?)
        .item(&cit168_menu.build()?)
        .item(&hcp_thalamus_menu.build()?)
        .item(&hcp_hippamyg_menu.build()?);

    // Specialized Atlases submenu
    let mut specialized_menu = SubmenuBuilder::new(app, "Specialized");

    // Olsen MTL
    let mut olsen_mtl_menu = SubmenuBuilder::new(app, "Olsen MTL");
    for preset in get_olsen_mtl_presets() {
        olsen_mtl_menu = olsen_mtl_menu.item(
            &MenuItemBuilder::new(&preset.label)
                .id(&preset.menu_id)
                .build(app)?,
        );
    }

    // Hippocampus
    let mut hippocampus_menu = SubmenuBuilder::new(app, "Hippocampus");
    for preset in get_hippocampus_presets() {
        hippocampus_menu = hippocampus_menu.item(
            &MenuItemBuilder::new(&preset.label)
                .id(&preset.menu_id)
                .build(app)?,
        );
    }

    // MDTB10 Cerebellum
    let mut mdtb10_menu = SubmenuBuilder::new(app, "MDTB10 Cerebellum");
    for preset in get_mdtb10_presets() {
        mdtb10_menu = mdtb10_menu.item(
            &MenuItemBuilder::new(&preset.label)
                .id(&preset.menu_id)
                .build(app)?,
        );
    }

    specialized_menu = specialized_menu
        .item(&olsen_mtl_menu.build()?)
        .item(&hippocampus_menu.build()?)
        .item(&mdtb10_menu.build()?);

    // Surface Atlases submenu
    let surface_atlases_menu = build_surface_atlases_submenu(app)?;

    // Build the main Atlases menu
    SubmenuBuilder::new(app, "Atlases")
        .item(&cortical_menu.build()?)
        .item(&subcortical_menu.build()?)
        .item(&specialized_menu.build()?)
        .separator()
        .item(&surface_atlases_menu)
        .build()
}

// ============================================================================
// Surface Atlas Presets
// ============================================================================

/// Surface atlas preset configuration for menu items
#[derive(Debug, Clone)]
pub struct SurfaceAtlasPreset {
    /// Menu ID (e.g., "surface_atlas_glasser_pial")
    pub menu_id: String,
    /// Display label (e.g., "360 parcels (pial)")
    pub label: String,
    /// Atlas identifier (e.g., "glasser2016")
    pub atlas_id: String,
    /// Coordinate space (e.g., "fsaverage")
    pub space: String,
    /// Surface type (e.g., "pial")
    pub surf_type: String,
    /// For Schaefer: number of parcels
    pub parcels: Option<u32>,
    /// For Schaefer: number of networks
    pub networks: Option<u8>,
}

impl SurfaceAtlasPreset {
    /// Generate JSON payload for this preset
    pub fn to_payload(&self) -> serde_json::Value {
        let mut payload = serde_json::json!({
            "atlas_id": self.atlas_id,
            "space": self.space,
            "resolution": "surface",
            "data_type": "surface",
            "surf_type": self.surf_type,
        });

        if let Some(networks) = self.networks {
            payload["networks"] = serde_json::json!(networks);
        }
        if let Some(parcels) = self.parcels {
            payload["parcels"] = serde_json::json!(parcels);
        }

        payload
    }
}

/// Get Glasser surface atlas presets
pub fn get_glasser_surface_presets() -> Vec<SurfaceAtlasPreset> {
    vec![SurfaceAtlasPreset {
        menu_id: "surface_atlas_glasser_pial".to_string(),
        label: "360 parcels (pial)".to_string(),
        atlas_id: "glasser2016".to_string(),
        space: "fsaverage".to_string(),
        surf_type: "pial".to_string(),
        parcels: None,
        networks: None,
    }]
}

/// Get Schaefer surface atlas presets
pub fn get_schaefer_surface_presets() -> Vec<SurfaceAtlasPreset> {
    let parcel_options = [100, 200, 400, 600, 1000];
    let network_options: [(u8, &str); 2] = [(7, "7"), (17, "17")];

    let mut presets = Vec::new();

    for &(networks, _net_label) in &network_options {
        for &parcels in &parcel_options {
            presets.push(SurfaceAtlasPreset {
                menu_id: format!("surface_atlas_schaefer_{}_{}", parcels, networks),
                label: format!("{} parcels", parcels),
                atlas_id: "schaefer2018".to_string(),
                space: "fsaverage".to_string(),
                surf_type: "pial".to_string(),
                parcels: Some(parcels),
                networks: Some(networks),
            });
        }
    }

    presets
}

/// Get all surface atlas presets
pub fn get_all_surface_atlas_presets() -> Vec<SurfaceAtlasPreset> {
    let mut all = Vec::new();
    all.extend(get_glasser_surface_presets());
    all.extend(get_schaefer_surface_presets());
    all
}

/// Find a surface atlas preset by menu ID
pub fn find_surface_atlas_preset_by_menu_id(menu_id: &str) -> Option<SurfaceAtlasPreset> {
    get_all_surface_atlas_presets()
        .into_iter()
        .find(|p| p.menu_id == menu_id)
}

/// Build the Surface Atlases submenu
pub fn build_surface_atlases_submenu(
    app: &App<Wry>,
) -> Result<tauri::menu::Submenu<Wry>, tauri::Error> {
    let mut surface_menu = SubmenuBuilder::new(app, "Surface Atlases");

    // Glasser 2016 (HCP-MMP1.0)
    let mut glasser_surf_menu = SubmenuBuilder::new(app, "Glasser 2016 (HCP-MMP1.0)");
    for preset in get_glasser_surface_presets() {
        glasser_surf_menu = glasser_surf_menu.item(
            &MenuItemBuilder::new(&preset.label)
                .id(&preset.menu_id)
                .build(app)?,
        );
    }
    surface_menu = surface_menu.item(&glasser_surf_menu.build()?);

    // Schaefer 2018
    let mut schaefer_surf_menu = SubmenuBuilder::new(app, "Schaefer 2018");

    // 7 Networks group
    let mut schaefer_7_surf = SubmenuBuilder::new(app, "7 Networks");
    for preset in get_schaefer_surface_presets()
        .iter()
        .filter(|p| p.networks == Some(7))
    {
        schaefer_7_surf = schaefer_7_surf.item(
            &MenuItemBuilder::new(&preset.label)
                .id(&preset.menu_id)
                .build(app)?,
        );
    }

    // 17 Networks group
    let mut schaefer_17_surf = SubmenuBuilder::new(app, "17 Networks");
    for preset in get_schaefer_surface_presets()
        .iter()
        .filter(|p| p.networks == Some(17))
    {
        schaefer_17_surf = schaefer_17_surf.item(
            &MenuItemBuilder::new(&preset.label)
                .id(&preset.menu_id)
                .build(app)?,
        );
    }

    schaefer_surf_menu = schaefer_surf_menu
        .item(&schaefer_7_surf.build()?)
        .item(&schaefer_17_surf.build()?);

    surface_menu = surface_menu.item(&schaefer_surf_menu.build()?);

    surface_menu.build()
}

// ============================================================================
// Surface Template Presets
// ============================================================================

/// Surface template preset configuration for menu items
#[derive(Debug, Clone)]
pub struct SurfaceTemplatePreset {
    /// Menu ID (e.g., "surface_fsaverage_white_L")
    pub menu_id: String,
    /// Display label (e.g., "White Matter (Left)")
    pub label: String,
    /// Surface space (e.g., "fsaverage", "fsaverage5")
    pub space: String,
    /// Geometry type (e.g., "white", "pial", "inflated")
    pub geometry_type: String,
    /// Hemisphere (e.g., "L", "R")
    pub hemisphere: String,
}

impl SurfaceTemplatePreset {
    pub fn new(space: &str, geometry_type: &str, hemisphere: &str, label: &str) -> Self {
        let menu_id = format!("surface_{}_{}_{}", space, geometry_type, hemisphere);
        Self {
            menu_id,
            label: label.to_string(),
            space: space.to_string(),
            geometry_type: geometry_type.to_string(),
            hemisphere: hemisphere.to_string(),
        }
    }

    /// Generate JSON payload for this preset
    pub fn to_payload(&self) -> serde_json::Value {
        let space = match self.space.as_str() {
            "fsaverage" => "fsaverage",
            "fsaverage5" => "fsaverage5",
            "fsaverage6" => "fsaverage6",
            "fsaverage7" => "fsaverage7",
            _ => "fsaverage",
        };

        let geometry_type = match self.geometry_type.as_str() {
            "white" => "white",
            "pial" => "pial",
            "inflated" => "inflated",
            "sphere" => "sphere",
            _ => "white",
        };

        let hemisphere = match self.hemisphere.as_str() {
            "L" => "left",
            "R" => "right",
            _ => "left",
        };

        serde_json::json!({
            "space": space,
            "geometry_type": geometry_type,
            "hemisphere": hemisphere
        })
    }
}

/// Get fsaverage (164k) surface template presets
fn get_fsaverage_presets() -> Vec<SurfaceTemplatePreset> {
    let space = "fsaverage";
    vec![
        // Left hemisphere
        SurfaceTemplatePreset::new(space, "white", "L", "White Matter (Left)"),
        SurfaceTemplatePreset::new(space, "pial", "L", "Pial (Left)"),
        SurfaceTemplatePreset::new(space, "inflated", "L", "Inflated (Left)"),
        SurfaceTemplatePreset::new(space, "sphere", "L", "Sphere (Left)"),
        // Right hemisphere
        SurfaceTemplatePreset::new(space, "white", "R", "White Matter (Right)"),
        SurfaceTemplatePreset::new(space, "pial", "R", "Pial (Right)"),
        SurfaceTemplatePreset::new(space, "inflated", "R", "Inflated (Right)"),
        SurfaceTemplatePreset::new(space, "sphere", "R", "Sphere (Right)"),
    ]
}

/// Get fsaverage5 (10k) surface template presets
fn get_fsaverage5_presets() -> Vec<SurfaceTemplatePreset> {
    let space = "fsaverage5";
    vec![
        // Left hemisphere
        SurfaceTemplatePreset::new(space, "white", "L", "White Matter (Left)"),
        SurfaceTemplatePreset::new(space, "pial", "L", "Pial (Left)"),
        SurfaceTemplatePreset::new(space, "inflated", "L", "Inflated (Left)"),
        SurfaceTemplatePreset::new(space, "sphere", "L", "Sphere (Left)"),
        // Right hemisphere
        SurfaceTemplatePreset::new(space, "white", "R", "White Matter (Right)"),
        SurfaceTemplatePreset::new(space, "pial", "R", "Pial (Right)"),
        SurfaceTemplatePreset::new(space, "inflated", "R", "Inflated (Right)"),
        SurfaceTemplatePreset::new(space, "sphere", "R", "Sphere (Right)"),
    ]
}

/// Get fsaverage6 (41k) surface template presets
fn get_fsaverage6_presets() -> Vec<SurfaceTemplatePreset> {
    let space = "fsaverage6";
    vec![
        // Left hemisphere
        SurfaceTemplatePreset::new(space, "white", "L", "White Matter (Left)"),
        SurfaceTemplatePreset::new(space, "pial", "L", "Pial (Left)"),
        SurfaceTemplatePreset::new(space, "inflated", "L", "Inflated (Left)"),
        SurfaceTemplatePreset::new(space, "sphere", "L", "Sphere (Left)"),
        // Right hemisphere
        SurfaceTemplatePreset::new(space, "white", "R", "White Matter (Right)"),
        SurfaceTemplatePreset::new(space, "pial", "R", "Pial (Right)"),
        SurfaceTemplatePreset::new(space, "inflated", "R", "Inflated (Right)"),
        SurfaceTemplatePreset::new(space, "sphere", "R", "Sphere (Right)"),
    ]
}

/// Get all surface template presets
pub fn get_all_surface_presets() -> Vec<SurfaceTemplatePreset> {
    let mut all = Vec::new();
    all.extend(get_fsaverage_presets());
    all.extend(get_fsaverage5_presets());
    all.extend(get_fsaverage6_presets());
    all
}

/// Find a surface template preset by menu ID
pub fn find_surface_preset_by_menu_id(menu_id: &str) -> Option<SurfaceTemplatePreset> {
    get_all_surface_presets()
        .into_iter()
        .find(|p| p.menu_id == menu_id)
}

/// Build the Surface Templates menu
pub fn build_surface_templates_menu(
    app: &App<Wry>,
) -> Result<tauri::menu::Submenu<Wry>, tauri::Error> {
    let mut surfaces_menu = SubmenuBuilder::new(app, "Surface Templates");

    // fsaverage (164k vertices) submenu
    let mut fsaverage_menu = SubmenuBuilder::new(app, "fsaverage (164k)");
    let mut fsaverage_left = SubmenuBuilder::new(app, "Left Hemisphere");
    let mut fsaverage_right = SubmenuBuilder::new(app, "Right Hemisphere");

    for preset in get_fsaverage_presets() {
        let menu_item = MenuItemBuilder::new(&preset.label)
            .id(&preset.menu_id)
            .build(app)?;

        if preset.hemisphere == "L" {
            fsaverage_left = fsaverage_left.item(&menu_item);
        } else {
            fsaverage_right = fsaverage_right.item(&menu_item);
        }
    }

    fsaverage_menu = fsaverage_menu
        .item(&fsaverage_left.build()?)
        .item(&fsaverage_right.build()?);
    surfaces_menu = surfaces_menu.item(&fsaverage_menu.build()?);

    // fsaverage5 (10k vertices) submenu
    let mut fsaverage5_menu = SubmenuBuilder::new(app, "fsaverage5 (10k)");
    let mut fsaverage5_left = SubmenuBuilder::new(app, "Left Hemisphere");
    let mut fsaverage5_right = SubmenuBuilder::new(app, "Right Hemisphere");

    for preset in get_fsaverage5_presets() {
        let menu_item = MenuItemBuilder::new(&preset.label)
            .id(&preset.menu_id)
            .build(app)?;

        if preset.hemisphere == "L" {
            fsaverage5_left = fsaverage5_left.item(&menu_item);
        } else {
            fsaverage5_right = fsaverage5_right.item(&menu_item);
        }
    }

    fsaverage5_menu = fsaverage5_menu
        .item(&fsaverage5_left.build()?)
        .item(&fsaverage5_right.build()?);
    surfaces_menu = surfaces_menu.item(&fsaverage5_menu.build()?);

    // fsaverage6 (41k vertices) submenu
    let mut fsaverage6_menu = SubmenuBuilder::new(app, "fsaverage6 (41k)");
    let mut fsaverage6_left = SubmenuBuilder::new(app, "Left Hemisphere");
    let mut fsaverage6_right = SubmenuBuilder::new(app, "Right Hemisphere");

    for preset in get_fsaverage6_presets() {
        let menu_item = MenuItemBuilder::new(&preset.label)
            .id(&preset.menu_id)
            .build(app)?;

        if preset.hemisphere == "L" {
            fsaverage6_left = fsaverage6_left.item(&menu_item);
        } else {
            fsaverage6_right = fsaverage6_right.item(&menu_item);
        }
    }

    fsaverage6_menu = fsaverage6_menu
        .item(&fsaverage6_left.build()?)
        .item(&fsaverage6_right.build()?);
    surfaces_menu = surfaces_menu.item(&fsaverage6_menu.build()?);

    surfaces_menu.build()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Template tests
    #[test]
    fn test_mni152_presets_count() {
        let presets = get_mni152_2009c_presets();
        // 4 anatomical + 6 tissue + 4 masks = 14 presets
        assert_eq!(presets.len(), 14);
    }

    #[test]
    fn test_all_template_presets_have_valid_ids() {
        for preset in get_all_template_presets() {
            assert!(preset.menu_id.starts_with("template_"));
            assert!(!preset.space.is_empty());
            assert!(!preset.template_type.is_empty());
            assert!(!preset.resolution.is_empty());
        }
    }

    #[test]
    fn test_template_menu_id_format() {
        let preset = TemplatePreset::new(
            "MNI152NLin2009cAsym",
            "T1w",
            "1mm",
            "T1 1mm",
            TemplateCategory::Anatomical,
        );
        assert_eq!(preset.menu_id, "template_MNI152NLin2009cAsym_T1w_1mm");
    }

    #[test]
    fn test_find_template_preset_by_menu_id() {
        let preset = find_template_preset_by_menu_id("template_MNI152NLin2009cAsym_T1w_1mm");
        assert!(preset.is_some());
        let preset = preset.unwrap();
        assert_eq!(preset.space, "MNI152NLin2009cAsym");
        assert_eq!(preset.template_type, "T1w");
        assert_eq!(preset.resolution, "1mm");
    }

    #[test]
    fn test_template_preset_payload_generation() {
        let preset = TemplatePreset::new(
            "MNI152NLin2009cAsym",
            "T1w",
            "1mm",
            "T1 1mm",
            TemplateCategory::Anatomical,
        );
        let payload = preset.to_payload();
        assert_eq!(payload["template_id"], "MNI152NLin2009cAsym_T1w_1mm");
        assert_eq!(payload["space"], "MNI152NLin2009cAsym");
        assert_eq!(payload["template_type"], "T1w");
        assert_eq!(payload["resolution"], "1mm");
    }

    // Atlas tests
    #[test]
    fn test_schaefer_presets_count() {
        let presets = get_schaefer_presets();
        // 5 parcel options * 2 network options = 10 presets
        assert_eq!(presets.len(), 10);
    }

    #[test]
    fn test_all_atlas_presets_have_valid_ids() {
        for preset in get_all_presets() {
            assert!(preset.menu_id.starts_with("atlas_"));
            assert!(!preset.atlas_id.is_empty());
            assert!(!preset.space.is_empty());
            assert!(!preset.resolution.is_empty());
        }
    }

    #[test]
    fn test_find_preset_by_menu_id() {
        let preset = find_preset_by_menu_id("atlas_schaefer2018_400_7");
        assert!(preset.is_some());
        let preset = preset.unwrap();
        assert_eq!(preset.parcels, Some(400));
        assert_eq!(preset.networks, Some(7));
    }

    #[test]
    fn test_preset_payload_generation() {
        let preset = AtlasPreset::new(
            "atlas_test",
            "Test Atlas",
            "test_atlas",
            "MNI152NLin2009cAsym",
            "1mm",
        )
        .with_schaefer_params(400, 7);

        let payload = preset.to_payload();
        assert_eq!(payload["atlas_id"], "test_atlas");
        assert_eq!(payload["space"], "MNI152NLin2009cAsym");
        assert_eq!(payload["resolution"], "1mm");
        assert_eq!(payload["networks"], 7);
        assert_eq!(payload["parcels"], 400);
    }

    // Surface template tests
    #[test]
    fn test_fsaverage_presets_count() {
        let presets = get_fsaverage_presets();
        // 4 geometry types * 2 hemispheres = 8 presets
        assert_eq!(presets.len(), 8);
    }

    #[test]
    fn test_all_surface_presets_count() {
        let presets = get_all_surface_presets();
        // 3 spaces * 4 geometry types * 2 hemispheres = 24 presets
        assert_eq!(presets.len(), 24);
    }

    #[test]
    fn test_all_surface_presets_have_valid_ids() {
        for preset in get_all_surface_presets() {
            assert!(preset.menu_id.starts_with("surface_"));
            assert!(!preset.space.is_empty());
            assert!(!preset.geometry_type.is_empty());
            assert!(preset.hemisphere == "L" || preset.hemisphere == "R");
        }
    }

    #[test]
    fn test_surface_template_menu_id_format() {
        let preset = SurfaceTemplatePreset::new("fsaverage", "white", "L", "White Matter (Left)");
        assert_eq!(preset.menu_id, "surface_fsaverage_white_L");
    }

    #[test]
    fn test_find_surface_preset_by_menu_id() {
        let preset = find_surface_preset_by_menu_id("surface_fsaverage_pial_R");
        assert!(preset.is_some());
        let preset = preset.unwrap();
        assert_eq!(preset.space, "fsaverage");
        assert_eq!(preset.geometry_type, "pial");
        assert_eq!(preset.hemisphere, "R");
    }

    #[test]
    fn test_surface_preset_payload_generation() {
        let preset = SurfaceTemplatePreset::new("fsaverage5", "inflated", "L", "Inflated (Left)");

        let payload = preset.to_payload();
        assert_eq!(payload["space"], "fsaverage5");
        assert_eq!(payload["geometry_type"], "inflated");
        assert_eq!(payload["hemisphere"], "left");
    }

    // Surface atlas tests
    #[test]
    fn test_glasser_surface_presets_count() {
        let presets = get_glasser_surface_presets();
        assert_eq!(presets.len(), 1);
        assert_eq!(presets[0].atlas_id, "glasser2016");
    }

    #[test]
    fn test_schaefer_surface_presets_count() {
        let presets = get_schaefer_surface_presets();
        // 5 parcel options * 2 network options = 10
        assert_eq!(presets.len(), 10);
    }

    #[test]
    fn test_all_surface_atlas_presets_have_valid_ids() {
        for preset in get_all_surface_atlas_presets() {
            assert!(preset.menu_id.starts_with("surface_atlas_"));
            assert!(!preset.atlas_id.is_empty());
            assert_eq!(preset.space, "fsaverage");
        }
    }

    #[test]
    fn test_find_surface_atlas_preset_by_menu_id() {
        let preset = find_surface_atlas_preset_by_menu_id("surface_atlas_glasser_pial");
        assert!(preset.is_some());
        let preset = preset.unwrap();
        assert_eq!(preset.atlas_id, "glasser2016");
        assert_eq!(preset.surf_type, "pial");
    }

    #[test]
    fn test_find_schaefer_surface_preset() {
        let preset = find_surface_atlas_preset_by_menu_id("surface_atlas_schaefer_400_7");
        assert!(preset.is_some());
        let preset = preset.unwrap();
        assert_eq!(preset.parcels, Some(400));
        assert_eq!(preset.networks, Some(7));
    }

    #[test]
    fn test_surface_atlas_preset_payload() {
        let preset = find_surface_atlas_preset_by_menu_id("surface_atlas_schaefer_200_17").unwrap();
        let payload = preset.to_payload();
        assert_eq!(payload["atlas_id"], "schaefer2018");
        assert_eq!(payload["space"], "fsaverage");
        assert_eq!(payload["data_type"], "surface");
        assert_eq!(payload["surf_type"], "pial");
        assert_eq!(payload["parcels"], 200);
        assert_eq!(payload["networks"], 17);
    }

    #[test]
    fn test_surface_atlas_schaefer_1000_payload() {
        let preset = find_surface_atlas_preset_by_menu_id("surface_atlas_schaefer_1000_17")
            .expect("surface_atlas_schaefer_1000_17 preset should exist");
        let payload = preset.to_payload();

        assert_eq!(payload["atlas_id"], "schaefer2018");
        assert_eq!(payload["space"], "fsaverage");
        assert_eq!(payload["data_type"], "surface");
        assert_eq!(payload["surf_type"], "pial");
        assert_eq!(payload["parcels"], 1000);
        assert_eq!(payload["networks"], 17);
    }
}
