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
// Data-driven volume-template menu builder, not yet wired into main.rs (audit #6).
#[allow(dead_code)]
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

#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq)]
pub enum TemplateCategory {
    Anatomical,        // T1w, T2w
    TissueProbability, // GM, WM, CSF
    BrainMask,         // mask, brain
}

#[allow(dead_code)]
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
#[allow(dead_code)]
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
#[allow(dead_code)]
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
#[allow(dead_code)]
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
#[allow(dead_code)]
pub fn get_all_template_presets() -> Vec<TemplatePreset> {
    let mut all = Vec::new();
    all.extend(get_mni152_2009c_presets());
    all.extend(get_mnicolin27_presets());
    all.extend(get_mni305_presets());
    all
}

/// Find a template preset by menu ID
#[allow(dead_code)]
pub fn find_template_preset_by_menu_id(menu_id: &str) -> Option<TemplatePreset> {
    get_all_template_presets()
        .into_iter()
        .find(|p| p.menu_id == menu_id)
}

/// Build the Templates menu
#[allow(dead_code)]
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

/// Get all atlas presets organized by category
pub fn get_all_presets() -> Vec<AtlasPreset> {
    let mut all = Vec::new();
    all.extend(get_schaefer_presets());
    all.extend(get_glasser_presets());
    all.extend(get_aseg_presets());
    all.extend(get_olsen_mtl_presets());
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

    subcortical_menu = subcortical_menu.item(&aseg_menu.build()?);

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

    specialized_menu = specialized_menu.item(&olsen_mtl_menu.build()?);

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
            "both" => "both",
            _ => "left",
        };

        serde_json::json!({
            "space": space,
            "geometry_type": geometry_type,
            "hemisphere": hemisphere
        })
    }
}

/// Get fsaverage (164k) surface template presets.
///
/// TemplateFlow fsaverage ships no inflated geometry; offering "Inflated" here
/// silently loaded pial instead, so it is not listed.
fn get_fsaverage_presets() -> Vec<SurfaceTemplatePreset> {
    let space = "fsaverage";
    vec![
        // Bilateral (default geometry click — loads both hemispheres)
        SurfaceTemplatePreset::new(space, "white", "both", "White Matter"),
        SurfaceTemplatePreset::new(space, "pial", "both", "Pial"),
        SurfaceTemplatePreset::new(space, "sphere", "both", "Sphere"),
        // Left hemisphere
        SurfaceTemplatePreset::new(space, "white", "L", "White Matter (Left)"),
        SurfaceTemplatePreset::new(space, "pial", "L", "Pial (Left)"),
        SurfaceTemplatePreset::new(space, "sphere", "L", "Sphere (Left)"),
        // Right hemisphere
        SurfaceTemplatePreset::new(space, "white", "R", "White Matter (Right)"),
        SurfaceTemplatePreset::new(space, "pial", "R", "Pial (Right)"),
        SurfaceTemplatePreset::new(space, "sphere", "R", "Sphere (Right)"),
    ]
}

/// Get fsaverage5 (10k) surface template presets
fn get_fsaverage5_presets() -> Vec<SurfaceTemplatePreset> {
    let space = "fsaverage5";
    vec![
        // Bilateral (default geometry click — loads both hemispheres)
        SurfaceTemplatePreset::new(space, "white", "both", "White Matter"),
        SurfaceTemplatePreset::new(space, "pial", "both", "Pial"),
        SurfaceTemplatePreset::new(space, "sphere", "both", "Sphere"),
        // Left hemisphere
        SurfaceTemplatePreset::new(space, "white", "L", "White Matter (Left)"),
        SurfaceTemplatePreset::new(space, "pial", "L", "Pial (Left)"),
        SurfaceTemplatePreset::new(space, "sphere", "L", "Sphere (Left)"),
        // Right hemisphere
        SurfaceTemplatePreset::new(space, "white", "R", "White Matter (Right)"),
        SurfaceTemplatePreset::new(space, "pial", "R", "Pial (Right)"),
        SurfaceTemplatePreset::new(space, "sphere", "R", "Sphere (Right)"),
    ]
}

/// Get fsaverage6 (41k) surface template presets
fn get_fsaverage6_presets() -> Vec<SurfaceTemplatePreset> {
    let space = "fsaverage6";
    vec![
        // Bilateral (default geometry click — loads both hemispheres)
        SurfaceTemplatePreset::new(space, "white", "both", "White Matter"),
        SurfaceTemplatePreset::new(space, "pial", "both", "Pial"),
        SurfaceTemplatePreset::new(space, "sphere", "both", "Sphere"),
        // Left hemisphere
        SurfaceTemplatePreset::new(space, "white", "L", "White Matter (Left)"),
        SurfaceTemplatePreset::new(space, "pial", "L", "Pial (Left)"),
        SurfaceTemplatePreset::new(space, "sphere", "L", "Sphere (Left)"),
        // Right hemisphere
        SurfaceTemplatePreset::new(space, "white", "R", "White Matter (Right)"),
        SurfaceTemplatePreset::new(space, "pial", "R", "Pial (Right)"),
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

        match preset.hemisphere.as_str() {
            // Bilateral items are the prominent default at the top level.
            "both" => fsaverage_menu = fsaverage_menu.item(&menu_item),
            "L" => fsaverage_left = fsaverage_left.item(&menu_item),
            _ => fsaverage_right = fsaverage_right.item(&menu_item),
        }
    }

    let fsaverage_single = SubmenuBuilder::new(app, "Single Hemisphere")
        .item(&fsaverage_left.build()?)
        .item(&fsaverage_right.build()?)
        .build()?;
    fsaverage_menu = fsaverage_menu.item(&fsaverage_single);
    surfaces_menu = surfaces_menu.item(&fsaverage_menu.build()?);

    // fsaverage5 (10k vertices) submenu
    let mut fsaverage5_menu = SubmenuBuilder::new(app, "fsaverage5 (10k)");
    let mut fsaverage5_left = SubmenuBuilder::new(app, "Left Hemisphere");
    let mut fsaverage5_right = SubmenuBuilder::new(app, "Right Hemisphere");

    for preset in get_fsaverage5_presets() {
        let menu_item = MenuItemBuilder::new(&preset.label)
            .id(&preset.menu_id)
            .build(app)?;

        match preset.hemisphere.as_str() {
            "both" => fsaverage5_menu = fsaverage5_menu.item(&menu_item),
            "L" => fsaverage5_left = fsaverage5_left.item(&menu_item),
            _ => fsaverage5_right = fsaverage5_right.item(&menu_item),
        }
    }

    let fsaverage5_single = SubmenuBuilder::new(app, "Single Hemisphere")
        .item(&fsaverage5_left.build()?)
        .item(&fsaverage5_right.build()?)
        .build()?;
    fsaverage5_menu = fsaverage5_menu.item(&fsaverage5_single);
    surfaces_menu = surfaces_menu.item(&fsaverage5_menu.build()?);

    // fsaverage6 (41k vertices) submenu
    let mut fsaverage6_menu = SubmenuBuilder::new(app, "fsaverage6 (41k)");
    let mut fsaverage6_left = SubmenuBuilder::new(app, "Left Hemisphere");
    let mut fsaverage6_right = SubmenuBuilder::new(app, "Right Hemisphere");

    for preset in get_fsaverage6_presets() {
        let menu_item = MenuItemBuilder::new(&preset.label)
            .id(&preset.menu_id)
            .build(app)?;

        match preset.hemisphere.as_str() {
            "both" => fsaverage6_menu = fsaverage6_menu.item(&menu_item),
            "L" => fsaverage6_left = fsaverage6_left.item(&menu_item),
            _ => fsaverage6_right = fsaverage6_right.item(&menu_item),
        }
    }

    let fsaverage6_single = SubmenuBuilder::new(app, "Single Hemisphere")
        .item(&fsaverage6_left.build()?)
        .item(&fsaverage6_right.build()?)
        .build()?;
    fsaverage6_menu = fsaverage6_menu.item(&fsaverage6_single);
    surfaces_menu = surfaces_menu.item(&fsaverage6_menu.build()?);

    surfaces_menu.build()
}

// ============================================================================
// View › Layout and View › Workspace
// ============================================================================

/// The `workspace-action` payload for a View › Layout or View › Workspace item
/// (ui2 `useWorkspaceMenuListener`). Layouts apply to the current tab in place;
/// New View opens a tab; a core tool opens once and is refocused afterwards.
/// Module tools are module menu items (below), not navigation items.
pub fn navigation_menu_action(menu_id: &str) -> Option<serde_json::Value> {
    let layout = |layout: &str| serde_json::json!({ "action": "set-layout", "payload": { "layout": layout } });
    let tool =
        |kind: &str| serde_json::json!({ "action": "open-tool", "payload": { "type": kind } });
    Some(match menu_id {
        "layout_orthogonal" => layout("orthogonal"),
        "layout_integrated" => layout("integrated"),
        "layout_mosaic" => layout("mosaic"),
        "layout_compare" => layout("compare"),
        "layout_orthogonal_panels" => layout("orthogonal-flexible"),
        "workspace_new_view" => serde_json::json!({ "action": "new-view" }),
        "workspace_set_studio" => tool("set-studio"),
        "workspace_bids" => tool("bids-explorer"),
        _ => return None,
    })
}

// ============================================================================
// Module menu items (docs/plans/module-architecture.md, "Menus")
// ============================================================================
//
// The UI sends a menu model (`set_module_menu_items` in main.rs) listing the
// items of the modules that are switched on. Rust keeps the predefined items,
// accelerators and their order, places each module item at its path, and a
// click emits `module-command` with the command id, which the UI runs through
// its module registry (ui2 `modules/runtime.ts`).

/// Menu-id prefix of a module item; the rest of the id is the command id.
pub const MODULE_COMMAND_MENU_PREFIX: &str = "module_command:";
/// Event a module item emits on click: `{ "command": "<module>.<name>" }`.
pub const MODULE_COMMAND_EVENT: &str = "module-command";
/// Upper bound on module items, against a runaway model.
pub const MAX_MODULE_MENU_ITEMS: usize = 64;
const MAX_MODULE_MENU_LABEL: usize = 64;

/// One item of the UI's menu model.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
pub struct ModuleMenuItem {
    /// Namespaced command id, `<module>.<name>`.
    pub command: String,
    pub label: String,
    /// Menu path, e.g. `view/workspace`.
    pub path: String,
}

/// Where module items may go.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModuleMenuPath {
    /// View › Workspace, after New View and the core tools.
    ViewWorkspace,
}

impl ModuleMenuPath {
    fn parse(path: &str) -> Option<Self> {
        match path {
            "view/workspace" => Some(Self::ViewWorkspace),
            _ => None,
        }
    }
}

/// A validated module item: its menu id, label and place.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedModuleMenuItem {
    pub id: String,
    pub label: String,
    pub path: ModuleMenuPath,
}

/// `<module>.<name>`: a lowercase module id, a dot, then letters, digits,
/// `.`, `_` or `-` (the UI registry's namespacing rule).
fn is_module_command_id(command: &str) -> bool {
    let Some((module, name)) = command.split_once('.') else {
        return false;
    };
    let module_ok = module.starts_with(|c: char| c.is_ascii_lowercase())
        && module
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    let name_ok = name.starts_with(|c: char| c.is_ascii_alphanumeric())
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    module_ok && name_ok
}

/// Validate the UI's menu model and give each item its menu id, in order.
/// The whole model is rejected if any item is invalid, so a bad update never
/// leaves half a menu.
pub fn plan_module_menu_items(
    items: &[ModuleMenuItem],
) -> Result<Vec<PlannedModuleMenuItem>, String> {
    if items.len() > MAX_MODULE_MENU_ITEMS {
        return Err(format!(
            "{} module menu items; at most {MAX_MODULE_MENU_ITEMS} are allowed",
            items.len()
        ));
    }
    let mut seen = std::collections::HashSet::new();
    items
        .iter()
        .map(|item| {
            if !is_module_command_id(&item.command) {
                return Err(format!(
                    "module menu item `{}` is not a namespaced command id (<module>.<name>)",
                    item.command
                ));
            }
            if !seen.insert(item.command.as_str()) {
                return Err(format!("module menu item `{}` is listed twice", item.command));
            }
            let label = item.label.trim();
            if label.is_empty()
                || label.chars().count() > MAX_MODULE_MENU_LABEL
                || label.chars().any(char::is_control)
            {
                return Err(format!(
                    "module menu item `{}` needs a label of 1-{MAX_MODULE_MENU_LABEL} printable characters",
                    item.command
                ));
            }
            let path = ModuleMenuPath::parse(&item.path).ok_or_else(|| {
                format!(
                    "module menu item `{}` has unknown path `{}`",
                    item.command, item.path
                )
            })?;
            Ok(PlannedModuleMenuItem {
                id: format!("{MODULE_COMMAND_MENU_PREFIX}{}", item.command),
                label: label.to_string(),
                path,
            })
        })
        .collect()
}

/// The `module-command` payload of a clicked module item, or None for any
/// other menu id.
pub fn module_command_payload(menu_id: &str) -> Option<serde_json::Value> {
    let command = menu_id.strip_prefix(MODULE_COMMAND_MENU_PREFIX)?;
    is_module_command_id(command).then(|| serde_json::json!({ "command": command }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every View › Layout / View › Workspace item in main.rs emits an action.
    #[test]
    fn every_navigation_menu_id_has_an_action() {
        let main_rs = include_str!("main.rs");
        let mut checked = 0;
        for prefix in [".id(\"layout_", ".id(\"workspace_"] {
            for chunk in main_rs.split(prefix).skip(1) {
                let rest = chunk.split('"').next().unwrap();
                let id = format!("{}{}", &prefix[5..], rest);
                assert!(
                    navigation_menu_action(&id).is_some(),
                    "menu item `{id}` has no workspace-action"
                );
                checked += 1;
            }
        }
        assert_eq!(checked, 8, "expected 5 layout items and 3 workspace items");
        // View › Layout › Integrated follows the UI feature flag.
        assert!(main_rs.contains("app.listen(\"integrated-layout-availability\""));
        assert!(main_rs.contains("integrated_item.set_enabled(enabled)"));
    }

    /// Cmd+1–4 set the current tab's layout, Cmd+5/6 open tools, Cmd+T opens a
    /// view; each accelerator is bound once.
    #[test]
    fn navigation_menu_accelerators_are_unique_and_mapped() {
        let main_rs = include_str!("main.rs");
        let expected = [
            ("CmdOrCtrl+1", "layout_orthogonal"),
            ("CmdOrCtrl+2", "layout_integrated"),
            ("CmdOrCtrl+3", "layout_mosaic"),
            ("CmdOrCtrl+4", "layout_compare"),
            ("CmdOrCtrl+5", "workspace_set_studio"),
            ("CmdOrCtrl+6", "workspace_bids"),
            ("CmdOrCtrl+T", "workspace_new_view"),
            ("CmdOrCtrl+,", "app_settings"),
        ];
        for (accelerator, id) in expected {
            let needle = format!(".accelerator(\"{accelerator}\")");
            assert_eq!(
                main_rs.matches(&needle).count(),
                1,
                "{accelerator} must be bound exactly once"
            );
            let item = format!(".id(\"{id}\")\n");
            let at = main_rs
                .find(&item)
                .unwrap_or_else(|| panic!("no menu item `{id}`"));
            let next_line = main_rs[at + item.len()..].lines().next().unwrap_or("");
            assert!(
                next_line.contains(&needle),
                "`{id}` should carry {accelerator}, found `{}`",
                next_line.trim()
            );
        }
    }

    /// Settings... (Cmd+,) sits in the app menu and has a handler that emits
    /// the event ui2 turns into `open-app-settings`.
    #[test]
    fn settings_menu_item_is_in_app_menu_and_handled() {
        let main_rs = include_str!("main.rs");
        let app_menu_start = main_rs
            .find("SubmenuBuilder::new(app, \"Brainflow\")")
            .expect("app menu");
        let app_menu_end = app_menu_start
            + main_rs[app_menu_start..]
                .find("PredefinedMenuItem::quit")
                .expect("app menu ends with Quit");
        assert!(
            main_rs[app_menu_start..app_menu_end].contains(".id(\"app_settings\")"),
            "Settings... belongs in the app menu"
        );
        assert_eq!(main_rs.matches(".id(\"app_settings\")").count(), 1);
        let handler = main_rs
            .find("\"app_settings\" => {")
            .expect("app_settings handler");
        assert!(main_rs[handler..].contains("\"app-settings-action\""));
    }

    #[test]
    fn navigation_menu_actions_never_create_tabs_for_layouts() {
        for id in [
            "layout_orthogonal",
            "layout_integrated",
            "layout_mosaic",
            "layout_compare",
            "layout_orthogonal_panels",
        ] {
            assert_eq!(navigation_menu_action(id).unwrap()["action"], "set-layout");
        }
        assert_eq!(
            navigation_menu_action("layout_orthogonal_panels").unwrap()["payload"]["layout"],
            "orthogonal-flexible"
        );
        assert_eq!(
            navigation_menu_action("workspace_new_view").unwrap()["action"],
            "new-view"
        );
        assert_eq!(
            navigation_menu_action("workspace_bids").unwrap()["payload"]["type"],
            "bids-explorer"
        );
        assert!(navigation_menu_action("workspace_orthogonal_locked").is_none());
        // Module tools come from the UI's menu model, not a fixed id.
        assert!(navigation_menu_action("workspace_analysis").is_none());
    }

    fn module_item(command: &str, label: &str, path: &str) -> ModuleMenuItem {
        ModuleMenuItem {
            command: command.into(),
            label: label.into(),
            path: path.into(),
        }
    }

    #[test]
    fn module_menu_items_are_placed_in_order_with_prefixed_ids() {
        let planned = plan_module_menu_items(&[
            module_item("analysis.open", " Analysis ", "view/workspace"),
            module_item("segmentation.segment", "Segment", "view/workspace"),
        ])
        .expect("valid model");
        assert_eq!(
            planned,
            vec![
                PlannedModuleMenuItem {
                    id: "module_command:analysis.open".into(),
                    label: "Analysis".into(),
                    path: ModuleMenuPath::ViewWorkspace,
                },
                PlannedModuleMenuItem {
                    id: "module_command:segmentation.segment".into(),
                    label: "Segment".into(),
                    path: ModuleMenuPath::ViewWorkspace,
                },
            ]
        );
        assert_eq!(plan_module_menu_items(&[]).unwrap(), vec![]);
    }

    #[test]
    fn module_menu_model_is_rejected_whole_when_an_item_is_invalid() {
        let ok = module_item("analysis.open", "Analysis", "view/workspace");
        for (bad, why) in [
            (module_item("open", "Open", "view/workspace"), "namespaced"),
            (
                module_item("Analysis.open", "Open", "view/workspace"),
                "namespaced",
            ),
            (
                module_item("analysis.", "Open", "view/workspace"),
                "namespaced",
            ),
            (
                module_item("analysis.open", "Again", "view/workspace"),
                "twice",
            ),
            (module_item("seg.x", "  ", "view/workspace"), "label"),
            (
                module_item("seg.x", "Line\nbreak", "view/workspace"),
                "label",
            ),
            (
                module_item("seg.x", &"x".repeat(65), "view/workspace"),
                "label",
            ),
            (module_item("seg.x", "X", "file/open"), "unknown path"),
        ] {
            let err = plan_module_menu_items(&[ok.clone(), bad]).expect_err(why);
            assert!(err.contains(why), "{err}");
        }
        let many: Vec<_> = (0..=MAX_MODULE_MENU_ITEMS)
            .map(|i| module_item(&format!("m.c{i}"), "C", "view/workspace"))
            .collect();
        assert!(plan_module_menu_items(&many).is_err());
    }

    #[test]
    fn module_menu_clicks_emit_the_command_id() {
        assert_eq!(
            module_command_payload("module_command:analysis.open").unwrap(),
            serde_json::json!({ "command": "analysis.open" })
        );
        assert!(module_command_payload("module_command:not-namespaced").is_none());
        assert!(module_command_payload("workspace_bids").is_none());
        assert!(module_command_payload("analysis.open").is_none());
    }

    /// main.rs registers the host command, keeps the Workspace submenu for
    /// module items, and turns clicks on them into `module-command`.
    #[test]
    fn module_menu_items_are_wired_in_main() {
        let main_rs = include_str!("main.rs");
        let handler = main_rs
            .find("tauri::generate_handler![")
            .expect("invoke handler");
        assert!(main_rs[handler..].contains("set_module_menu_items"));
        assert!(!main_rs.contains("update_dynamic_menus"));
        assert!(main_rs.contains("app.manage(ModuleMenus"));
        let arm = main_rs
            .find("id if id.starts_with(menu_builder::MODULE_COMMAND_MENU_PREFIX)")
            .expect("module command arm");
        assert!(main_rs[arm..].contains("menu_builder::module_command_payload(id)"));
        assert!(main_rs[arm..].contains("menu_builder::MODULE_COMMAND_EVENT"));
        // The arm must come before the generic prefix arms that could swallow it.
        let template_arm = main_rs.find("id if id.starts_with(\"template_\")").unwrap();
        assert!(arm < template_arm);
        assert!(!main_rs.contains("workspace_analysis"));
    }

    /// Every Templates-menu item must name a catalog entry; otherwise the click
    /// fails with "Template not found" (seen for brain_* and GM/WM/CSF 2mm).
    #[test]
    fn every_template_menu_id_exists_in_catalog() {
        let main_rs = include_str!("main.rs");
        let catalog = templates::TemplateCatalog::new();
        let mut checked = 0;
        for chunk in main_rs.split(".id(\"template_").skip(1) {
            let id = chunk.split('"').next().unwrap();
            assert!(
                catalog.get_by_id(id).is_some(),
                "Templates menu offers `{id}` but core/templates/catalog.json has no such entry"
            );
            checked += 1;
        }
        assert!(
            checked > 10,
            "expected to find the Templates menu ids in main.rs"
        );
    }

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
        // 3 geometry types (no inflated: fsaverage loads pial in its place) * 3 hemisphere
        // variants (both, L, R) = 9 presets
        assert_eq!(presets.len(), 9);
    }

    #[test]
    fn test_all_surface_presets_count() {
        let presets = get_all_surface_presets();
        // 3 spaces * 3 geometry types (no inflated) * 3 hemisphere variants (both, L, R) = 27
        assert_eq!(presets.len(), 27);
    }

    #[test]
    fn test_all_surface_presets_have_valid_ids() {
        for preset in get_all_surface_presets() {
            assert!(preset.menu_id.starts_with("surface_"));
            assert!(!preset.space.is_empty());
            assert!(!preset.geometry_type.is_empty());
            assert!(
                preset.hemisphere == "L" || preset.hemisphere == "R" || preset.hemisphere == "both"
            );
        }
    }

    #[test]
    fn test_bilateral_surface_preset_payload() {
        let preset = find_surface_preset_by_menu_id("surface_fsaverage_pial_both")
            .expect("bilateral preset should exist");
        let payload = preset.to_payload();
        assert_eq!(payload["space"], "fsaverage");
        assert_eq!(payload["geometry_type"], "pial");
        assert_eq!(payload["hemisphere"], "both");
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
