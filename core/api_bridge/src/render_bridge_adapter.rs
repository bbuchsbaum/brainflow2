//! Brainflow render bridge adapter.
//!
//! This module owns conversion between Brainflow's frontend/Tauri render
//! payloads and the renderer-facing contracts from `render_loop`. Keep app
//! orchestration, registry lookup, leases, and event emission in `lib.rs`; keep
//! reusable GPU behavior in `render_loop`.
//!
//! Response packet contracts:
//! - `render_view` with `rgba`/`raw` returns
//!   `[u32 width LE][u32 height LE][width * height * 4 RGBA8 bytes]`.
//! - `render_view` with `png` returns a PNG byte stream with no wrapper.
//! - `render_views` returns `[u32 view_count LE]`, then one header per view:
//!   `[u8 view_code][u32 width LE][u32 height LE][u32 payload_len LE]`, followed
//!   by all payload bytes in header order. For `rgba`/`raw`, each payload is
//!   bare RGBA8 bytes, excluding the single-view width/height header. For
//!   `png`, each payload is a PNG byte stream.

use bridge_types::{BridgeError, BridgeResult};
use colormap::colormap_by_name;
use render_loop::render_state::{BlendMode, LayerMode, ThresholdMode};
use render_loop::view_state::{
    AlphaModConfig, AlphaModMode, CameraState, InterpolationMode, LayerConfig, SliceOrientation,
    ThresholdConfig, ViewState,
};
use render_loop::SliceFeatureUbo;

use crate::{FrontendViewState, LayerState, RenderFormat};

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct RenderViewTarget {
    pub requested_view: Option<String>,
    pub width: u32,
    pub height: u32,
    pub orientation: SliceOrientation,
    pub frame_origin: [f32; 4],
    pub frame_u_vec: [f32; 4],
    pub frame_v_vec: [f32; 4],
}

impl RenderFormat {
    pub(crate) fn label(self) -> &'static str {
        match self {
            RenderFormat::Png => "png",
            RenderFormat::RawRgba => "rgba",
        }
    }
}

pub(crate) fn parse_frontend_view_state(
    json: &str,
) -> Result<FrontendViewState, serde_json::Error> {
    serde_json::from_str::<FrontendViewState>(json)
}

pub(crate) fn select_view_target(frontend_state: &FrontendViewState) -> RenderViewTarget {
    if let Some(req_view) = &frontend_state.requested_view {
        return RenderViewTarget {
            requested_view: Some(req_view.view_type.clone()),
            width: req_view.width,
            height: req_view.height,
            orientation: orientation_for_view_type(&req_view.view_type),
            frame_origin: req_view.origin_mm,
            frame_u_vec: req_view.u_mm,
            frame_v_vec: req_view.v_mm,
        };
    }

    let axial = &frontend_state.views.axial;
    RenderViewTarget {
        requested_view: None,
        width: 512,
        height: 512,
        orientation: SliceOrientation::Axial,
        frame_origin: [
            axial.origin_mm[0],
            axial.origin_mm[1],
            axial.origin_mm[2],
            1.0,
        ],
        frame_u_vec: [axial.u_mm[0], axial.u_mm[1], axial.u_mm[2], 0.0],
        frame_v_vec: [axial.v_mm[0], axial.v_mm[1], axial.v_mm[2], 0.0],
    }
}

pub(crate) fn build_backend_view_state(
    frontend_state: &FrontendViewState,
    backend_layers: Vec<LayerConfig>,
    target: &RenderViewTarget,
) -> ViewState {
    ViewState {
        layout_version: ViewState::CURRENT_VERSION,
        camera: CameraState {
            world_center: frontend_state.crosshair.world_mm,
            fov_mm: 256.0,
            orientation: target.orientation,
            frame_origin: Some(target.frame_origin),
            frame_u_vec: Some(target.frame_u_vec),
            frame_v_vec: Some(target.frame_v_vec),
        },
        crosshair_world: frontend_state.crosshair.world_mm,
        layers: backend_layers,
        viewport_size: [target.width, target.height],
        show_crosshair: frontend_state.crosshair.visible,
        crosshair_color: frontend_state.crosshair.color,
        timepoint: frontend_state.timepoint,
    }
}

pub(crate) fn frontend_layer_to_backend_layer(layer: &LayerState) -> Option<LayerConfig> {
    if !is_renderable_layer(layer) {
        return None;
    }

    // Prefer an explicit, backend-registered colormap slot (e.g. a categorical atlas
    // palette) when the frontend supplies one. Validate it is within the GPU LUT
    // array bounds so an arbitrary id can never index out of range; otherwise fall
    // back to resolving the colormap by name.
    let max_colormap_layers = colormap::BuiltinColormap::COUNT as u32
        + render_loop::texture_manager::CUSTOM_COLORMAP_SLOTS;
    let colormap_id = match layer.colormap_id {
        Some(id) if id < max_colormap_layers => id,
        _ => match colormap_by_name(&layer.colormap) {
            Some(id) => id.id() as u32,
            None => 0,
        },
    };

    let blend_mode = match layer.blend_mode.as_str() {
        "alpha" | "normal" => BlendMode::Normal,
        "additive" => BlendMode::Additive,
        "max" | "maximum" => BlendMode::Maximum,
        "min" | "minimum" => BlendMode::Minimum,
        "multiply" => BlendMode::Multiply,
        _ => BlendMode::Normal,
    };

    let interpolation = match layer.interpolation.as_str() {
        "nearest" => InterpolationMode::Nearest,
        "cubic" => InterpolationMode::Cubic,
        _ => InterpolationMode::Linear,
    };
    let interpolation = match layer.layer_mode {
        LayerMode::Label | LayerMode::Mask => InterpolationMode::Nearest,
        LayerMode::Scalar => interpolation,
    };

    let threshold = if is_default_no_threshold(layer.threshold) {
        None
    } else {
        Some(ThresholdConfig {
            mode: ThresholdMode::Range,
            range: (layer.threshold[0], layer.threshold[1]),
        })
    };

    let alpha_mod = layer.alpha_mod.as_ref().and_then(|am| {
        let mode = match am.mode.as_str() {
            "linear" => AlphaModMode::Linear,
            "gamma" => AlphaModMode::Gamma,
            _ => AlphaModMode::Off,
        };
        if mode == AlphaModMode::Off {
            None
        } else {
            Some(AlphaModConfig {
                mode,
                gamma: am.gamma,
                center: am.center,
            })
        }
    });

    Some(LayerConfig {
        volume_id: layer.volume_id.clone(),
        opacity: layer.opacity,
        colormap_id,
        blend_mode,
        intensity_window: (layer.intensity[0], layer.intensity[1]),
        threshold,
        visible: layer.visible,
        interpolation,
        layer_mode: layer.layer_mode,
        alpha_mod,
    })
}

pub(crate) fn is_renderable_layer(layer: &LayerState) -> bool {
    layer.visible && layer.opacity > 0.0
}

fn is_default_no_threshold(threshold: [f32; 2]) -> bool {
    threshold == [0.0, 0.0] || threshold == [0.0, 100.0]
}

pub(crate) fn orientation_for_view_type(view_type: &str) -> SliceOrientation {
    match view_type {
        "sagittal" => SliceOrientation::Sagittal,
        "coronal" => SliceOrientation::Coronal,
        _ => SliceOrientation::Axial,
    }
}

pub(crate) fn slice_features_from_frontend_layers(layers: &[LayerState]) -> SliceFeatureUbo {
    let mut visible_layer_index = 0u32;

    for layer in layers {
        if !is_renderable_layer(layer) {
            continue;
        }

        if let Some(outline) = &layer.outline {
            // Outline is active whenever enabled on a label layer. With a specific
            // label selected we outline that parcel (mode 0); otherwise we outline
            // every parcel boundary (mode 1) so the toggle alone is meaningful.
            if outline.enabled && layer.layer_mode == LayerMode::Label {
                let outline_mode = if outline.selected_label_id > 0 { 0 } else { 1 };
                return SliceFeatureUbo {
                    outline_enabled: 1,
                    outline_layer_index: visible_layer_index,
                    selected_label_id: outline.selected_label_id,
                    outline_mode,
                    outline_color: outline.color,
                    outline_thickness_px: outline.thickness_px.max(1.0),
                    ..SliceFeatureUbo::default()
                };
            }
        }

        visible_layer_index += 1;
    }

    SliceFeatureUbo::default()
}

pub(crate) fn encode_raw_rgba_frame(width: u32, height: u32, rgba_data: Vec<u8>) -> Vec<u8> {
    let mut raw_buffer = Vec::with_capacity(8 + rgba_data.len());
    raw_buffer.extend_from_slice(&width.to_le_bytes());
    raw_buffer.extend_from_slice(&height.to_le_bytes());
    raw_buffer.extend_from_slice(&rgba_data);
    raw_buffer
}

#[cfg(test)]
pub(crate) fn split_raw_rgba_frame(bytes: &[u8]) -> BridgeResult<(u32, u32, Vec<u8>)> {
    if bytes.len() < 8 {
        return Err(BridgeError::Internal {
            code: 5102,
            details: "raw RGBA frame is missing its width/height header".to_string(),
        });
    }

    let width = u32::from_le_bytes(bytes[0..4].try_into().unwrap());
    let height = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
    Ok((width, height, bytes[8..].to_vec()))
}

pub(crate) fn encode_png_frame(
    width: u32,
    height: u32,
    rgba_data: Vec<u8>,
) -> BridgeResult<Vec<u8>> {
    use image::codecs::png::PngEncoder;
    use image::{ImageBuffer, ImageEncoder, Rgba};
    use std::io::Cursor;

    let img_buffer: ImageBuffer<Rgba<u8>, Vec<u8>> =
        ImageBuffer::from_raw(width, height, rgba_data).ok_or_else(|| BridgeError::Internal {
            code: 5022,
            details: format!(
                "Failed to create image buffer from RGBA data. Width: {}, Height: {}",
                width, height
            ),
        })?;

    let mut png_data = Vec::new();
    let encoder = PngEncoder::new_with_quality(
        Cursor::new(&mut png_data),
        image::codecs::png::CompressionType::Fast,
        image::codecs::png::FilterType::NoFilter,
    );
    encoder
        .write_image(
            img_buffer.as_raw(),
            width,
            height,
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|e| BridgeError::Internal {
            code: 5023,
            details: format!("Failed to encode PNG: {}", e),
        })?;

    Ok(png_data)
}

pub(crate) fn encode_error_png_frame(width: u32, height: u32) -> BridgeResult<Vec<u8>> {
    let width_usize = width as usize;
    let height_usize = height as usize;
    let mut dark_image = vec![30u8; width_usize * height_usize * 4];

    for y in 0..height_usize {
        for x in 0..width_usize {
            if x < 2
                || x >= width_usize.saturating_sub(2)
                || y < 2
                || y >= height_usize.saturating_sub(2)
            {
                let idx = (y * width_usize + x) * 4;
                dark_image[idx] = 128;
                dark_image[idx + 1] = 0;
                dark_image[idx + 2] = 0;
                dark_image[idx + 3] = 255;
            }
        }
    }

    encode_png_frame(width, height, dark_image)
}

pub(crate) struct MultiViewPacketEntry {
    pub view_code: u8,
    pub width: u32,
    pub height: u32,
    pub payload: Vec<u8>,
}

pub(crate) fn encode_view_type(view_type: &str) -> BridgeResult<u8> {
    match view_type.to_lowercase().as_str() {
        "axial" => Ok(0),
        "sagittal" => Ok(1),
        "coronal" => Ok(2),
        other => Err(BridgeError::Input {
            code: 4101,
            details: format!("Unsupported view type '{}'", other),
        }),
    }
}

pub(crate) fn encode_multi_view_packet(entries: &[MultiViewPacketEntry]) -> BridgeResult<Vec<u8>> {
    let mut packet = Vec::new();
    packet.extend_from_slice(&(entries.len() as u32).to_le_bytes());

    for entry in entries {
        packet.push(entry.view_code);
        packet.extend_from_slice(&entry.width.to_le_bytes());
        packet.extend_from_slice(&entry.height.to_le_bytes());
        let len_u32: u32 = entry
            .payload
            .len()
            .try_into()
            .map_err(|_| BridgeError::Internal {
                code: 5103,
                details: "Payload too large to encode in response".to_string(),
            })?;
        packet.extend_from_slice(&len_u32.to_le_bytes());
    }

    for entry in entries {
        packet.extend_from_slice(&entry.payload);
    }

    Ok(packet)
}

#[cfg(test)]
mod tests {
    use super::*;
    use render_loop::view_state::{FrameDiagnostics, FrameReadbackMode};

    const FRONTEND_FIXTURE: &str = r#"{
        "views": {
            "axial": {
                "origin_mm": [1.0, 2.0, 3.0],
                "u_mm": [4.0, 0.0, 0.0],
                "v_mm": [0.0, 5.0, 0.0]
            },
            "sagittal": {
                "origin_mm": [10.0, 20.0, 30.0],
                "u_mm": [0.0, 40.0, 0.0],
                "v_mm": [0.0, 0.0, 50.0]
            },
            "coronal": {
                "origin_mm": [-1.0, -2.0, -3.0],
                "u_mm": [6.0, 0.0, 0.0],
                "v_mm": [0.0, 0.0, 7.0]
            }
        },
        "crosshair": {
            "world_mm": [12.0, 13.0, 14.0],
            "visible": false,
            "color": [0.2, 0.3, 0.4, 0.5]
        },
        "timepoint": 3,
        "requestedView": {
            "type": "sagittal",
            "origin_mm": [101.0, 102.0, 103.0, 1.0],
            "u_mm": [0.0, 8.0, 0.0, 0.0],
            "v_mm": [0.0, 0.0, 9.0, 0.0],
            "width": 320,
            "height": 240
        },
        "layers": [
            {
                "id": "hidden",
                "volumeId": "vol-hidden",
                "visible": false,
                "opacity": 1.0,
                "colormap": "gray",
                "intensity": [0.0, 1.0],
                "threshold": [0.0, 100.0],
                "blendMode": "alpha"
            },
            {
                "id": "label-layer",
                "volumeId": "vol-label",
                "visible": true,
                "opacity": 0.6,
                "colormap": "viridis",
                "intensity": [2.0, 7.0],
                "threshold": [3.0, 6.0],
                "blendMode": "additive",
                "interpolation": "linear",
                "layerMode": "label",
                "outline": {
                    "enabled": true,
                    "selectedLabelId": 42,
                    "color": [1.0, 0.0, 0.0, 1.0],
                    "thicknessPx": 2.5
                }
            }
        ]
    }"#;

    #[test]
    fn frontend_fixture_converts_to_backend_view_state() {
        let frontend = parse_frontend_view_state(FRONTEND_FIXTURE).expect("fixture parses");
        let target = select_view_target(&frontend);
        let backend_layers: Vec<_> = frontend
            .layers
            .iter()
            .filter_map(frontend_layer_to_backend_layer)
            .collect();

        let backend = build_backend_view_state(&frontend, backend_layers, &target);

        assert_eq!(target.requested_view.as_deref(), Some("sagittal"));
        assert_eq!(target.orientation, SliceOrientation::Sagittal);
        assert_eq!(target.width, 320);
        assert_eq!(target.height, 240);
        assert_eq!(target.frame_origin, [101.0, 102.0, 103.0, 1.0]);
        assert_eq!(target.frame_u_vec, [0.0, 8.0, 0.0, 0.0]);
        assert_eq!(target.frame_v_vec, [0.0, 0.0, 9.0, 0.0]);

        assert_eq!(backend.camera.orientation, SliceOrientation::Sagittal);
        assert_eq!(
            backend.camera.frame_origin,
            Some([101.0, 102.0, 103.0, 1.0])
        );
        assert_eq!(backend.camera.frame_u_vec, Some([0.0, 8.0, 0.0, 0.0]));
        assert_eq!(backend.camera.frame_v_vec, Some([0.0, 0.0, 9.0, 0.0]));
        assert_eq!(backend.viewport_size, [320, 240]);
        assert_eq!(backend.timepoint, Some(3));
        assert_eq!(backend.crosshair_world, [12.0, 13.0, 14.0]);
        assert!(!backend.show_crosshair);
        assert_eq!(backend.crosshair_color, [0.2, 0.3, 0.4, 0.5]);

        assert_eq!(backend.layers.len(), 1);
        let layer = &backend.layers[0];
        assert_eq!(layer.volume_id, "vol-label");
        assert_eq!(layer.opacity, 0.6);
        assert_eq!(layer.blend_mode, BlendMode::Additive);
        assert_eq!(layer.intensity_window, (2.0, 7.0));
        assert_eq!(layer.threshold.as_ref().unwrap().range, (3.0, 6.0));
        assert_eq!(layer.threshold.as_ref().unwrap().mode, ThresholdMode::Range);
        assert_eq!(layer.interpolation, InterpolationMode::Nearest);
        assert_eq!(layer.layer_mode, LayerMode::Label);
    }

    #[test]
    fn alpha_mod_frontend_maps_to_backend_layer_config() {
        use render_loop::view_state::AlphaModMode;

        // gamma -> AlphaModMode::Gamma (fields preserved); off -> None; absent -> None.
        let json = r#"{
            "views": {
                "axial":    {"origin_mm":[0.0,0.0,0.0],"u_mm":[1.0,0.0,0.0],"v_mm":[0.0,1.0,0.0]},
                "sagittal": {"origin_mm":[0.0,0.0,0.0],"u_mm":[0.0,1.0,0.0],"v_mm":[0.0,0.0,1.0]},
                "coronal":  {"origin_mm":[0.0,0.0,0.0],"u_mm":[1.0,0.0,0.0],"v_mm":[0.0,0.0,1.0]}
            },
            "crosshair": {"world_mm":[0.0,0.0,0.0],"visible":true,"color":[0.0,1.0,0.0,0.8]},
            "layers": [
                {"id":"gamma","volumeId":"v1","visible":true,"opacity":1.0,"colormap":"gray",
                 "intensity":[-1.0,1.0],"threshold":[0.0,0.0],"blendMode":"alpha",
                 "alphaMod":{"mode":"gamma","gamma":2.5,"center":0.1}},
                {"id":"off","volumeId":"v2","visible":true,"opacity":1.0,"colormap":"gray",
                 "intensity":[0.0,1.0],"threshold":[0.0,0.0],"blendMode":"alpha",
                 "alphaMod":{"mode":"off","gamma":1.0,"center":0.0}},
                {"id":"none","volumeId":"v3","visible":true,"opacity":1.0,"colormap":"gray",
                 "intensity":[0.0,1.0],"threshold":[0.0,0.0],"blendMode":"alpha"}
            ]
        }"#;

        let frontend = parse_frontend_view_state(json).expect("fixture parses");
        let layers: Vec<_> = frontend
            .layers
            .iter()
            .filter_map(frontend_layer_to_backend_layer)
            .collect();
        assert_eq!(layers.len(), 3);

        let gamma = layers[0]
            .alpha_mod
            .as_ref()
            .expect("gamma layer carries alpha_mod");
        assert_eq!(gamma.mode, AlphaModMode::Gamma);
        assert_eq!(gamma.gamma, 2.5);
        assert_eq!(gamma.center, 0.1);

        assert!(
            layers[1].alpha_mod.is_none(),
            "mode=off must map to None (flat-opacity layer)"
        );
        assert!(
            layers[2].alpha_mod.is_none(),
            "absent alphaMod must map to None"
        );
    }

    #[test]
    fn frontend_blend_mode_names_map_to_backend_contract() {
        let layer = |id: &str, blend_mode: &str| {
            format!(
                r#"{{"id":"{id}","volumeId":"{id}","visible":true,"opacity":1.0,"colormap":"gray",
                 "intensity":[0.0,1.0],"threshold":[0.0,0.0],"blendMode":"{blend_mode}"}}"#
            )
        };
        let json = format!(
            r#"{{
            "views": {{
                "axial":    {{"origin_mm":[0.0,0.0,0.0],"u_mm":[1.0,0.0,0.0],"v_mm":[0.0,1.0,0.0]}},
                "sagittal": {{"origin_mm":[0.0,0.0,0.0],"u_mm":[0.0,1.0,0.0],"v_mm":[0.0,0.0,1.0]}},
                "coronal":  {{"origin_mm":[0.0,0.0,0.0],"u_mm":[1.0,0.0,0.0],"v_mm":[0.0,0.0,1.0]}}
            }},
            "crosshair": {{"world_mm":[0.0,0.0,0.0],"visible":true,"color":[0.0,1.0,0.0,0.8]}},
            "layers": [{}, {}, {}, {}, {}, {}, {}]
        }}"#,
            layer("alpha", "alpha"),
            layer("additive", "additive"),
            layer("max", "max"),
            layer("min", "min"),
            layer("maximum", "maximum"),
            layer("minimum", "minimum"),
            layer("multiply", "multiply")
        );

        let frontend = parse_frontend_view_state(&json).expect("fixture parses");
        let modes: Vec<_> = frontend
            .layers
            .iter()
            .filter_map(frontend_layer_to_backend_layer)
            .map(|layer| layer.blend_mode)
            .collect();

        assert_eq!(
            modes,
            vec![
                BlendMode::Normal,
                BlendMode::Additive,
                BlendMode::Maximum,
                BlendMode::Minimum,
                BlendMode::Maximum,
                BlendMode::Minimum,
                BlendMode::Multiply,
            ]
        );
    }

    #[test]
    fn default_view_uses_axial_frame_vectors() {
        let mut frontend = parse_frontend_view_state(FRONTEND_FIXTURE).expect("fixture parses");
        frontend.requested_view = None;

        let target = select_view_target(&frontend);

        assert_eq!(target.requested_view, None);
        assert_eq!(target.orientation, SliceOrientation::Axial);
        assert_eq!(target.width, 512);
        assert_eq!(target.height, 512);
        assert_eq!(target.frame_origin, [1.0, 2.0, 3.0, 1.0]);
        assert_eq!(target.frame_u_vec, [4.0, 0.0, 0.0, 0.0]);
        assert_eq!(target.frame_v_vec, [0.0, 5.0, 0.0, 0.0]);
    }

    #[test]
    fn slice_feature_conversion_uses_visible_layer_order() {
        let frontend = parse_frontend_view_state(FRONTEND_FIXTURE).expect("fixture parses");

        let features = slice_features_from_frontend_layers(&frontend.layers);

        assert_eq!(features.outline_enabled, 1);
        assert_eq!(features.outline_layer_index, 0);
        assert_eq!(features.selected_label_id, 42);
        assert_eq!(features.outline_color, [1.0, 0.0, 0.0, 1.0]);
        assert_eq!(features.outline_thickness_px, 2.5);
    }

    #[test]
    fn default_frontend_thresholds_disable_backend_thresholding() {
        let mut frontend = parse_frontend_view_state(FRONTEND_FIXTURE).expect("fixture parses");

        frontend.layers[1].threshold = [0.0, 0.0];
        let layer = frontend_layer_to_backend_layer(&frontend.layers[1]).unwrap();
        assert!(layer.threshold.is_none());

        frontend.layers[1].threshold = [0.0, 100.0];
        let layer = frontend_layer_to_backend_layer(&frontend.layers[1]).unwrap();
        assert!(layer.threshold.is_none());
    }

    #[test]
    fn raw_rgba_frame_has_documented_width_height_header() {
        let packet = encode_raw_rgba_frame(2, 1, vec![1, 2, 3, 4, 5, 6, 7, 8]);
        let (width, height, payload) = split_raw_rgba_frame(&packet).expect("raw frame decodes");

        assert_eq!(width, 2);
        assert_eq!(height, 1);
        assert_eq!(payload, vec![1, 2, 3, 4, 5, 6, 7, 8]);
    }

    #[test]
    fn png_frame_is_unwrapped_png_stream() {
        let png = encode_png_frame(1, 1, vec![255, 0, 0, 255]).expect("png encodes");

        assert!(png.starts_with(&[0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n']));
    }

    #[test]
    fn multi_view_packet_has_documented_header_then_payloads() {
        let packet = encode_multi_view_packet(&[
            MultiViewPacketEntry {
                view_code: encode_view_type("axial").unwrap(),
                width: 2,
                height: 3,
                payload: vec![10, 11],
            },
            MultiViewPacketEntry {
                view_code: encode_view_type("coronal").unwrap(),
                width: 4,
                height: 5,
                payload: vec![20, 21, 22],
            },
        ])
        .expect("packet encodes");

        assert_eq!(u32::from_le_bytes(packet[0..4].try_into().unwrap()), 2);
        assert_eq!(packet[4], 0);
        assert_eq!(u32::from_le_bytes(packet[5..9].try_into().unwrap()), 2);
        assert_eq!(u32::from_le_bytes(packet[9..13].try_into().unwrap()), 3);
        assert_eq!(u32::from_le_bytes(packet[13..17].try_into().unwrap()), 2);
        assert_eq!(packet[17], 2);
        assert_eq!(u32::from_le_bytes(packet[18..22].try_into().unwrap()), 4);
        assert_eq!(u32::from_le_bytes(packet[22..26].try_into().unwrap()), 5);
        assert_eq!(u32::from_le_bytes(packet[26..30].try_into().unwrap()), 3);
        assert_eq!(&packet[30..], &[10, 11, 20, 21, 22]);
    }

    #[test]
    fn render_format_labels_match_bridge_contract() {
        assert_eq!(RenderFormat::RawRgba.label(), "rgba");
        assert_eq!(RenderFormat::Png.label(), "png");
        let diagnostics = FrameDiagnostics {
            readback_mode: FrameReadbackMode::Skip,
            ..FrameDiagnostics::default()
        };
        assert_eq!(diagnostics.readback_mode, FrameReadbackMode::Skip);
    }
}
