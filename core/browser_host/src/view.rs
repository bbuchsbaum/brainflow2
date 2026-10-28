use render_contracts::{
    BlendMode, InterpolationMode, LayerConfig, SliceOrientation, ThresholdConfig, ThresholdMode,
    ViewState,
};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Payload {
    requested_view: Requested,
    crosshair: Crosshair,
    layers: Vec<Layer>,
    timepoint: Option<usize>,
}
#[derive(Deserialize)]
struct Requested {
    r#type: String,
    origin_mm: [f32; 4],
    u_mm: [f32; 4],
    v_mm: [f32; 4],
    width: u32,
    height: u32,
}
#[derive(Deserialize)]
struct Crosshair {
    world_mm: [f32; 3],
    #[serde(default)]
    visible: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Layer {
    volume_id: String,
    visible: bool,
    opacity: f32,
    colormap: String,
    intensity: [f32; 2],
    threshold: [f32; 2],
    blend_mode: Option<String>,
    interpolation: Option<String>,
    layer_mode: Option<String>,
    outline: Option<serde_json::Value>,
    alpha_mod: Option<serde_json::Value>,
}

pub fn decode(json: &str) -> Result<(String, ViewState), String> {
    let p: Payload = serde_json::from_str(json).map_err(|e| e.to_string())?;
    if p.timepoint.is_some_and(|t| t != 0) {
        return Err("Select browser timepoints through set_timepoint before rendering".into());
    }
    let r = p.requested_view;
    if r.width == 0 || r.height == 0 || r.width > 2048 || r.height > 2048 {
        return Err("Browser view must be 1–2048 pixels on each axis".into());
    }
    if !r
        .origin_mm
        .iter()
        .chain(r.u_mm.iter())
        .chain(r.v_mm.iter())
        .chain(p.crosshair.world_mm.iter())
        .all(|v| v.is_finite())
    {
        return Err("View coordinates must be finite".into());
    }
    let orientation = match r.r#type.as_str() {
        "axial" => SliceOrientation::Axial,
        "coronal" => SliceOrientation::Coronal,
        "sagittal" => SliceOrientation::Sagittal,
        _ => return Err("Unknown view orientation".into()),
    };
    let mut state = ViewState::from_basic_params(
        String::new(),
        p.crosshair.world_mm,
        orientation,
        1.,
        [r.width, r.height],
        (0., 1.),
    )
    .with_crosshair(p.crosshair.visible);
    state.camera.frame_origin = Some(r.origin_mm);
    state.camera.frame_u_vec = Some(r.u_mm);
    state.camera.frame_v_vec = Some(r.v_mm);
    state.layers.clear();
    for l in p.layers {
        if l.outline.is_some()
            || l.alpha_mod.is_some()
            || l.layer_mode
                .as_deref()
                .is_some_and(|m| m != "scalar" && m != "label")
        {
            return Err("Unsupported layer mode, outline or modulated-alpha display".into());
        }
        if !l
            .intensity
            .iter()
            .chain(l.threshold.iter())
            .chain(std::iter::once(&l.opacity))
            .all(|v| v.is_finite())
            || l.intensity[1] < l.intensity[0]
            || !(0.0..=1.0).contains(&l.opacity)
        {
            return Err("Invalid layer display values".into());
        }
        let cmap = colormap::colormap_by_name(&l.colormap).ok_or("Unsupported colormap")? as u32;
        let mut layer = LayerConfig::new(l.volume_id)
            .with_visibility(l.visible)
            .with_opacity(l.opacity)
            .with_colormap(cmap)
            .with_intensity_window(l.intensity[0], l.intensity[1]);
        layer.interpolation = match l.interpolation.as_deref().unwrap_or("linear") {
            "linear" => InterpolationMode::Linear,
            "nearest" => InterpolationMode::Nearest,
            _ => return Err("Unsupported interpolation".into()),
        };
        layer.blend_mode = match l.blend_mode.as_deref().unwrap_or("alpha") {
            "alpha" => BlendMode::Normal,
            "additive" => BlendMode::Additive,
            "max" => BlendMode::Maximum,
            "min" => BlendMode::Minimum,
            _ => return Err("Unsupported blend mode".into()),
        };
        if l.threshold[1] > l.threshold[0] {
            layer.threshold = Some(ThresholdConfig {
                mode: ThresholdMode::Range,
                range: (l.threshold[0], l.threshold[1]),
            });
        }
        state.layers.push(layer);
    }
    Ok((r.r#type, state))
}
