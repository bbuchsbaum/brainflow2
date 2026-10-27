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
            let VolumeSendable::VolF32(volume, _) = &prepared.data else {
                return Err("Unsupported decoded volume".into());
            };
            let info = source::describe(&handle, volume)?;
            self.renderer
                .register_volume(&handle.id, volume, RendererVolumeFormat::R32Float)
                .map_err(|e| e.to_string())?;
            Ok(info)
        })();
        if let Some(error) = device.pop_error_scope().await {
            let _ = self.renderer.release_volume_by_id(&handle.id);
            registration = Err(format!("GPU upload validation failed: {error}"));
        }
        if registration.is_err() {
            self.repository
                .remove(&handle.id)
                .await
                .map_err(|e| e.to_string())?;
        }
        registration
    }

    /// Same render_view arguments/8-byte RGBA envelope as the desktop adapter.
    pub async fn render_view(&mut self, state_json: &str) -> Result<Vec<u8>, String> {
        let (id, state) = view::decode(state_json)?;
        {
            let loaded = self.repository.volumes.lock().unwrap();
            for layer in &state.layers {
                if !loaded.contains_key(&layer.volume_id) {
                    return Err("Volume was unloaded".into());
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
        VolumeLoadingService::unload(&self.repository, id)
            .await
            .map_err(|e| e.to_string())
    }

    pub fn diagnostics(&self) -> String {
        let staging = self.renderer.readback_monitor().snapshot();
        serde_json::json!({"volumes":self.repository.volumes.lock().unwrap().len(),
            "stagingBuffers":staging.buffers,"stagingBytes":staging.bytes})
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
