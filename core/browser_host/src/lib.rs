//! Browser host of the shared loader lifecycle and WGPU facade.
//! Bytes have a browser-file identity, never a pretend native filesystem path.
mod source;
mod view;

use bridge_types::{BridgeError, BridgeResult, VolumeHandleInfo, VolumeSendable};
use render_contracts::{FrameRequestOptions, ViewId};
use render_loop::{RendererVolumeFormat, WgpuSliceRenderer, WgpuSliceRendererConfig};
use serde::Serialize;
use source::{MemorySource, Repository};
use volume_service::{LoadScope, VolumeLoadingService, VolumeRepository};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserVolume {
    pub id: String,
    pub name: String,
    pub dims: Vec<usize>,
    pub affine: [[f64; 4]; 4],
    pub center: [f64; 3],
    pub bounds: [[f64; 3]; 2],
    pub range: [f32; 2],
    pub frame_count: usize,
    pub current_frame: usize,
    pub label_ids: Option<Vec<u32>>,
}

pub struct BrowserHost {
    renderer: WgpuSliceRenderer,
    repository: Repository,
    next_id: u64,
}

impl BrowserHost {
    pub async fn configure() -> Result<Self, String> {
        Self::configure_with_texture_limit(None).await
    }

    /// Optional device ceiling is useful for embedded hosts and qualification.
    /// It constrains the actual requested device, not just reported diagnostics.
    pub async fn configure_with_texture_limit(
        sampled_texture_limit: Option<u32>,
    ) -> Result<Self, String> {
        let mut config = WgpuSliceRendererConfig::default();
        // The facade's declarative path uses dedicated volume textures; avoid
        // reserving the desktop's large legacy atlas in every worker.
        config.atlas.dimensions = [1, 1, 1];
        config.atlas.capacity_policy = render_loop::RendererCapacityPolicy::FitAdapter;
        config.device.limits.max_sampled_textures_per_shader_stage = sampled_texture_limit;
        config.device.float32_filterable = render_loop::RendererFeaturePolicy::Require;
        #[cfg(target_arch = "wasm32")]
        {
            config.adapter.backends = render_loop::RendererBackends::BrowserWebGpu;
        }
        Ok(Self {
            renderer: WgpuSliceRenderer::configure(config)
                .await
                .map_err(|e| format!("Browser GPU startup failed: {e}. Use a compatible WebGPU browser or the desktop app."))?,
            repository: Repository::default(),
            next_id: 0,
        })
    }

    pub fn capabilities(&self) -> render_loop::RendererCapabilities {
        self.renderer.capabilities()
    }

    pub async fn load_nifti(
        &mut self,
        name: String,
        bytes: Vec<u8>,
    ) -> Result<BrowserVolume, String> {
        self.load(name, bytes, false).await
    }

    pub async fn load_label_nifti(
        &mut self,
        name: String,
        bytes: Vec<u8>,
    ) -> Result<BrowserVolume, String> {
        self.load(name, bytes, true).await
    }

    async fn load(
        &mut self,
        name: String,
        bytes: Vec<u8>,
        labels: bool,
    ) -> Result<BrowserVolume, String> {
        let remaining_voxels = {
            let volumes = self.repository.volumes.lock().unwrap();
            let max_volumes = 4.min(self.renderer.capabilities().volume_slots as usize);
            if volumes.len() >= max_volumes {
                return Err(format!("Unload an image before opening another: this browser device supports up to {max_volumes} volumes"));
            }
            let used: usize = volumes
                .values()
                .map(|v| v.handle.dims.iter().product::<usize>())
                .sum();
            (64 * 1024 * 1024usize).saturating_sub(used)
        };
        self.next_id += 1;
        let scope = LoadScope::default();
        let source = MemorySource {
            name,
            bytes,
            id: format!("browser-{}", self.next_id),
            remaining_voxels,
            labels,
        };
        let handle = VolumeLoadingService::load(&source, &self.repository, &scope)
            .await
            .map_err(|e| e.to_string())?;
        let device = self.renderer.legacy_service().device.clone();
        device.push_error_scope(wgpu::ErrorFilter::Validation);
        let mut registration = (|| {
            let volumes = self.repository.volumes.lock().unwrap();
            let prepared = volumes
                .get(&handle.id)
                .ok_or("Decoded volume disappeared")?;
            let volume = source::spatial_frame(&prepared.data, 0)?;
            let mut info = source::describe(&handle, &volume)?;
            if let VolumeSendable::Vec4DF32(series) = &prepared.data {
                let (low, high) = series
                    .data
                    .iter()
                    .filter(|v| v.is_finite())
                    .fold((f32::INFINITY, f32::NEG_INFINITY), |(lo, hi), &v| {
                        (lo.min(v), hi.max(v))
                    });
                if !low.is_finite() || !high.is_finite() {
                    return Err("Volume contains no finite values".into());
                }
                info.range = [low, high];
            }
            if info.label_ids.is_some() {
                self.renderer.register_label_volume(&handle.id, &volume)
            } else {
                self.renderer
                    .register_volume(&handle.id, &volume, RendererVolumeFormat::R32Float)
            }
            .map_err(|e| e.to_string())?;
            Ok(info)
        })();
        if let Some(error) = device.pop_error_scope().await {
            registration = Err(format!("GPU upload validation failed: {error}"));
        }
        if registration.is_err() {
            let _ = self.renderer.release_volume_by_id(&handle.id);
            self.repository
                .remove(&handle.id)
                .await
                .map_err(|e| e.to_string())?;
        }
        registration
    }

    /// Replace the selected frame in the existing slot. Out-of-range requests
    /// fail before GPU mutation; publication follows successful validation.
    pub async fn set_timepoint(&mut self, id: &str, timepoint: usize) -> Result<(), String> {
        let frame = {
            let volumes = self.repository.volumes.lock().unwrap();
            let volume = volumes.get(id).ok_or("Volume was unloaded")?;
            let count = volume.handle.num_timepoints.unwrap_or(1);
            volume_service::frames::check_timepoint(timepoint, count).map_err(|e| e.to_string())?;
            if volume.handle.current_timepoint.unwrap_or(0) == timepoint {
                return Ok(());
            }
            source::spatial_frame(&volume.data, timepoint)?.into_owned()
        };
        let device = self.renderer.legacy_service().device.clone();
        device.push_error_scope(wgpu::ErrorFilter::Validation);
        let updated = self
            .renderer
            .update_scalar_volume(id, &frame)
            .map_err(|e| e.to_string());
        let validation = device.pop_error_scope().await;
        updated?;
        if let Some(error) = validation {
            return Err(format!("GPU frame update failed: {error}"));
        }
        self.repository
            .volumes
            .lock()
            .unwrap()
            .get_mut(id)
            .ok_or("Volume was unloaded")?
            .handle
            .current_timepoint = Some(timepoint);
        Ok(())
    }

    /// Same render_view arguments/8-byte RGBA envelope as the desktop adapter.
    pub async fn render_view(&mut self, state_json: &str) -> Result<Vec<u8>, String> {
        let (id, mut state) = view::decode(state_json)?;
        {
            let loaded = self.repository.volumes.lock().unwrap();
            for layer in &mut state.layers {
                let volume = loaded.get(&layer.volume_id).ok_or("Volume was unloaded")?;
                if volume.handle.is_label_map == Some(true) {
                    layer.layer_mode = render_contracts::LayerMode::Label;
                    layer.interpolation = render_contracts::InterpolationMode::Nearest;
                    layer.colormap_id = self
                        .renderer
                        .colormap_id(&layer.volume_id)
                        .ok_or("Label palette has not been installed")?;
                }
            }
        }
        let size = state.viewport_size;
        let device = self.renderer.legacy_service().device.clone();
        device.push_error_scope(wgpu::ErrorFilter::Validation);
        let submission = self
            .renderer
            .submit_frame_with_options(ViewId::new(id), state, FrameRequestOptions::default())
            .map_err(|e| e.to_string());
        let completion = match submission {
            Ok(s) => s.complete().await.map_err(|e| e.to_string()),
            Err(e) => Err(e),
        };
        let validation = device.pop_error_scope().await;
        if let Some(error) = validation {
            return Err(format!("GPU render validation failed: {error}"));
        }
        let result = completion?;
        let mut packet = Vec::with_capacity(8 + result.image_data.len());
        packet.extend_from_slice(&size[0].to_le_bytes());
        packet.extend_from_slice(&size[1].to_le_bytes());
        packet.extend_from_slice(&result.image_data);
        Ok(packet)
    }

    pub async fn unload(&mut self, id: &str) -> Result<(), String> {
        self.renderer.clear_views();
        self.renderer
            .release_volume_by_id(id)
            .map_err(|e| e.to_string())?;
        self.renderer.release_colormap(id);
        VolumeLoadingService::unload(&self.repository, id)
            .await
            .map_err(|e| e.to_string())
    }

    /// A palette belongs to its volume, with no independent browser registry.
    pub async fn set_label_palette(&mut self, id: &str, rgba: &[u8]) -> Result<(), String> {
        if self
            .repository
            .volumes
            .lock()
            .unwrap()
            .get(id)
            .is_none_or(|v| v.handle.is_label_map != Some(true))
        {
            return Err("A loaded label volume is required".into());
        }
        let width = render_loop::texture_manager::COLORMAP_LUT_WIDTH as usize;
        if rgba.len() != width * 4 || rgba[3] != 0 {
            return Err("Label palette must have 2048 RGBA entries and transparent label 0".into());
        }
        let device = self.renderer.legacy_service().device.clone();
        device.push_error_scope(wgpu::ErrorFilter::Validation);
        let result = self
            .renderer
            .upsert_colormap(id, rgba)
            .map_err(|e| e.to_string());
        let validation = device.pop_error_scope().await;
        result?;
        if let Some(error) = validation {
            self.renderer.release_colormap(id);
            return Err(format!("GPU palette upload failed: {error}"));
        }
        Ok(())
    }

    pub fn label_at_world(&self, id: &str, world: [f64; 3]) -> Result<Option<u32>, String> {
        if !world.iter().all(|v| v.is_finite()) {
            return Err("Coordinates must be finite".into());
        }
        let volumes = self.repository.volumes.lock().unwrap();
        let prepared = volumes.get(id).ok_or("Volume was unloaded")?;
        if prepared.handle.is_label_map != Some(true) {
            return Err("A label volume is required".into());
        }
        let volume = source::spatial_frame(&prepared.data, 0)?;
        let m = volume.space.0.trans.clone().fixed_resize::<4, 4>(0.0);
        let p = m.try_inverse().ok_or("Invalid affine")?
            * nalgebra::Vector4::new(world[0], world[1], world[2], 1.0);
        let mut coords = [0usize; 3];
        for axis in 0..3 {
            let index = (p[axis] + 0.5).floor();
            if !index.is_finite() || index < 0.0 || index >= prepared.handle.dims[axis] as f64 {
                return Ok(None);
            }
            coords[axis] = index as usize;
        }
        Ok(volume.get_at_coords(&coords).map(|v| v as u32))
    }

    pub fn diagnostics(&self) -> String {
        let staging = self.renderer.readback_monitor().snapshot();
        serde_json::json!({"volumes":self.repository.volumes.lock().unwrap().len(),
            "palettes":self.renderer.custom_colormap_count(),"stagingBuffers":staging.buffers,"stagingBytes":staging.bytes})
        .to_string()
    }
}

fn input(details: impl Into<String>) -> BridgeError {
    BridgeError::Input {
        code: 1003,
        details: details.into(),
    }
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    use super::*;
    use wasm_bindgen::prelude::*;
    /// A temporary decoder result, consumed by the worker and immediately freed.
    /// The browser canvas owns the transferred arrays; there is no Rust registry.
    #[wasm_bindgen]
    pub struct DecodedSurface {
        vertices: Vec<f32>,
        faces: Vec<u32>,
        hemisphere: String,
    }
    #[wasm_bindgen]
    impl DecodedSurface {
        pub fn vertices(&mut self) -> Vec<f32> {
            std::mem::take(&mut self.vertices)
        }
        pub fn faces(&mut self) -> Vec<u32> {
            std::mem::take(&mut self.faces)
        }
        pub fn hemisphere(&self) -> String {
            self.hemisphere.clone()
        }
    }
    #[wasm_bindgen]
    pub fn decode_surface(bytes: &[u8]) -> Result<DecodedSurface, JsValue> {
        let mesh =
            gifti_loader::geometry::read_surface(bytes).map_err(|e| JsValue::from_str(&e))?;
        Ok(DecodedSurface {
            vertices: mesh.vertices_world(),
            faces: mesh.faces,
            hemisphere: mesh.hemisphere,
        })
    }
    #[wasm_bindgen]
    pub fn decode_surface_scalar(bytes: &[u8]) -> Result<Vec<f32>, JsValue> {
        gifti_loader::geometry::read_scalar(bytes).map_err(|e| JsValue::from_str(&e))
    }
    #[wasm_bindgen(js_name = BrowserHost)]
    pub struct WasmHost {
        inner: BrowserHost,
    }
    #[wasm_bindgen(js_class = BrowserHost)]
    impl WasmHost {
        pub async fn create(sampled_texture_limit: Option<u32>) -> Result<WasmHost, JsValue> {
            console_error_panic_hook::set_once();
            Ok(Self {
                inner: BrowserHost::configure_with_texture_limit(sampled_texture_limit)
                    .await
                    .map_err(|e| JsValue::from_str(&e))?,
            })
        }
        pub fn capabilities(&self) -> String {
            serde_json::to_string(&self.inner.capabilities())
                .expect("finite GPU capability integers")
        }
        pub async fn load_nifti(
            &mut self,
            name: String,
            bytes: Vec<u8>,
        ) -> Result<String, JsValue> {
            let v = self
                .inner
                .load_nifti(name, bytes)
                .await
                .map_err(|e| JsValue::from_str(&e))?;
            serde_json::to_string(&v).map_err(|e| JsValue::from_str(&e.to_string()))
        }
        pub async fn load_label_nifti(
            &mut self,
            name: String,
            bytes: Vec<u8>,
        ) -> Result<String, JsValue> {
            let volume = self
                .inner
                .load_label_nifti(name, bytes)
                .await
                .map_err(|e| JsValue::from_str(&e))?;
            serde_json::to_string(&volume).map_err(|e| JsValue::from_str(&e.to_string()))
        }
        pub async fn set_label_palette(
            &mut self,
            id: String,
            rgba: Vec<u8>,
        ) -> Result<(), JsValue> {
            self.inner
                .set_label_palette(&id, &rgba)
                .await
                .map_err(|e| JsValue::from_str(&e))
        }
        pub fn label_at_world(
            &self,
            id: String,
            x: f64,
            y: f64,
            z: f64,
        ) -> Result<Option<u32>, JsValue> {
            self.inner
                .label_at_world(&id, [x, y, z])
                .map_err(|e| JsValue::from_str(&e))
        }
        pub async fn set_timepoint(
            &mut self,
            volume_id: String,
            timepoint: usize,
        ) -> Result<(), JsValue> {
            self.inner
                .set_timepoint(&volume_id, timepoint)
                .await
                .map_err(|e| JsValue::from_str(&e))
        }
        pub async fn render_view(&mut self, state_json: String) -> Result<Vec<u8>, JsValue> {
            self.inner
                .render_view(&state_json)
                .await
                .map_err(|e| JsValue::from_str(&e))
        }
        pub async fn unload(&mut self, id: String) -> Result<(), JsValue> {
            self.inner
                .unload(&id)
                .await
                .map_err(|e| JsValue::from_str(&e))
        }
        pub fn diagnostics(&self) -> String {
            self.inner.diagnostics()
        }
    }
}
