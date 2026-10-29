use super::*;
use async_trait::async_trait;
use nalgebra::{Affine3, Matrix4, Vector4};
use nifti::NiftiHeader;
use std::{
    collections::HashMap,
    io::{Cursor, Read},
    sync::Mutex,
};
use volmath::DenseVolume3;
use volume_service::{PreparedVolume, VolumeMetadataInfo, VolumeSource};

const MAX_SOURCE_BYTES: usize = 256 * 1024 * 1024;
const MAX_VOXELS: usize = 32 * 1024 * 1024;

pub struct MemorySource {
    pub name: String,
    pub bytes: Vec<u8>,
    pub id: String,
    pub remaining_voxels: usize,
    pub labels: bool,
}

#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
impl VolumeSource for MemorySource {
    async fn acquire(&self, scope: &LoadScope) -> BridgeResult<PreparedVolume> {
        scope.check()?;
        if self.bytes.len() > MAX_SOURCE_BYTES {
            return Err(input("File exceeds the 256 MiB browser input limit"));
        }
        let expanded;
        let bytes = if self.bytes.starts_with(&[0x1f, 0x8b]) {
            let mut decoder = flate2::read::GzDecoder::new(self.bytes.as_slice())
                .take((MAX_SOURCE_BYTES + 1) as u64);
            let mut data = Vec::new();
            decoder
                .read_to_end(&mut data)
                .map_err(|e| input(e.to_string()))?;
            if data.len() > MAX_SOURCE_BYTES {
                return Err(input(
                    "Expanded file exceeds the 256 MiB browser input limit",
                ));
            }
            expanded = data;
            expanded.as_slice()
        } else {
            self.bytes.as_slice()
        };
        // A bounded header preflight prevents hostile dimensions from requesting
        // unbounded allocations. Voxel decoding/scaling still happens once in neuroim.
        let header =
            NiftiHeader::from_reader(Cursor::new(bytes)).map_err(|e| input(e.to_string()))?;
        if !matches!(header.dim[0], 3 | 4) {
            return Err(input("This browser viewer supports scalar 3D or 4D NIfTI"));
        }
        if header.magic != *b"n+1\0" {
            return Err(input("Select a single-file NIfTI-1 .nii or .nii.gz"));
        }
        let labels = self.labels || header.intent_code == 1002;
        if labels
            && (header.dim[0] != 3
                || (!matches!(header.scl_slope, 0.0 | 1.0) || header.scl_inter != 0.0))
        {
            return Err(input("Label images must be 3D with identity NIfTI scaling"));
        }
        if !matches!(
            (header.datatype, header.bitpix),
            (2, 8)
                | (4, 16)
                | (8, 32)
                | (16, 32)
                | (64, 64)
                | (256, 8)
                | (512, 16)
                | (768, 32)
                | (1024, 64)
                | (1280, 64)
        ) {
            return Err(input(
                "This browser viewer requires a real scalar NIfTI datatype",
            ));
        }
        let ndim = header.dim[0] as usize;
        let frames = if ndim == 4 { header.dim[4] as usize } else { 1 };
        let count = header.dim[1..=ndim]
            .iter()
            .try_fold(1usize, |n, &d| n.checked_mul(d as usize));
        if !matches!(count, Some(n) if n > 0 && n <= MAX_VOXELS) {
            return Err(input("Volume exceeds the 32 million voxel browser limit"));
        }
        if count.unwrap() > self.remaining_voxels {
            return Err(input(
                "Workspace exceeds the 64 million resident voxel limit; unload an image first",
            ));
        }
        let data = if labels {
            // Use the native typed reader: the general-purpose reader first
            // converts through f32 even when its requested output type is f64.
            // Validate IDs in their original precision before any narrowing.
            macro_rules! decode_labels {
                ($ty:ty) => {{
                    let decoded = DenseVolume3::new(
                        neuroim::io::read_vol_from_reader_native_as::<$ty>(Cursor::new(bytes))
                            .map_err(|e| input(e.to_string()))?,
                    );
                    let values = decoded.values_contiguous();
                    let mut labels = Vec::with_capacity(values.len());
                    for &raw in values.iter() {
                        let v = raw as f64;
                        if !v.is_finite() || v < 0.0 ||
                            v >= render_loop::texture_manager::COLORMAP_LUT_WIDTH as f64 || v.fract() != 0.0 {
                            return Err(input("Label IDs must be integers from 0 to 2047 (0 is transparent background)"));
                        }
                        labels.push(v as f32);
                    }
                    DenseVolume3::from_data(decoded.space.clone(), labels)
                }};
            }
            let volume = match header.datatype {
                2 => decode_labels!(u8),
                4 => decode_labels!(i16),
                8 => decode_labels!(i32),
                16 => decode_labels!(f32),
                64 => decode_labels!(f64),
                256 => decode_labels!(i8),
                512 => decode_labels!(u16),
                768 => decode_labels!(u32),
                1024 => decode_labels!(i64),
                1280 => decode_labels!(u64),
                _ => unreachable!("datatype preflight"),
            };
            let transform = volume.space.0.trans.clone().fixed_resize::<4, 4>(0.0);
            VolumeSendable::VolF32(
                volume,
                Affine3::from_matrix_unchecked(transform.cast::<f32>()),
            )
        } else if ndim == 4 {
            VolumeSendable::Vec4DF32(
                neuroim::io::read_vec_from_reader_as::<f32>(Cursor::new(bytes))
                    .map_err(|e| input(e.to_string()))?,
            )
        } else {
            let volume = DenseVolume3::new(
                neuroim::io::read_vol_from_reader_as::<f32>(Cursor::new(bytes), 0)
                    .map_err(|e| input(e.to_string()))?,
            );
            let transform = volume.space.0.trans.clone().fixed_resize::<4, 4>(0.0);
            VolumeSendable::VolF32(
                volume,
                Affine3::from_matrix_unchecked(transform.cast::<f32>()),
            )
        };
        scope.check()?;
        let affine = volume_service::frames::affine_from_volume(&data)?;
        if !affine.matrix().iter().all(|v| v.is_finite()) || affine.matrix().try_inverse().is_none()
        {
            return Err(input("Volume affine must be finite and nonsingular"));
        }
        let volume_type = if ndim == 4 {
            bridge_types::VolumeType::TimeSeries4D
        } else {
            bridge_types::VolumeType::Volume3D
        };
        let handle = VolumeHandleInfo {
            id: self.id.clone(),
            name: self.name.clone(),
            dims: header.dim[1..=ndim].iter().map(|&v| v as usize).collect(),
            dtype: "f32".into(),
            volume_type: volume_type.clone(),
            num_timepoints: (ndim == 4).then_some(frames),
            current_timepoint: (ndim == 4).then_some(0),
            time_series_info: None,
            statistic: None,
            is_label_map: Some(labels),
        };
        Ok(PreparedVolume {
            data,
            metadata: VolumeMetadataInfo {
                name: self.name.clone(),
                path: format!("browser-file:{}", self.id),
                dtype: "f32".into(),
                volume_type: volume_type.clone(),
                time_series_info: None,
            },
            handle,
        })
    }
}

#[derive(Default)]
pub struct Repository {
    pub volumes: Mutex<HashMap<String, PreparedVolume>>,
}
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
impl VolumeRepository for Repository {
    async fn publish(
        &self,
        volume: PreparedVolume,
        scope: &LoadScope,
    ) -> BridgeResult<VolumeHandleInfo> {
        let mut volumes = self.volumes.lock().unwrap();
        scope.commit(|| {
            let handle = volume.handle.clone();
            volumes.insert(handle.id.clone(), volume);
            Ok(handle)
        })
    }
    async fn remove(&self, id: &str) -> BridgeResult<()> {
        self.volumes
            .lock()
            .unwrap()
            .remove(id)
            .ok_or_else(|| input("Volume is not loaded"))?;
        Ok(())
    }
}

pub fn describe(
    handle: &VolumeHandleInfo,
    volume: &DenseVolume3<f32>,
) -> Result<BrowserVolume, String> {
    let m: Matrix4<f64> = volume.space.0.trans.clone().fixed_resize::<4, 4>(0.0);
    let mut affine = [[0.; 4]; 4];
    for r in 0..4 {
        for c in 0..4 {
            affine[r][c] = m[(r, c)];
        }
    }
    let d = &handle.dims;
    let center = m * Vector4::new(
        (d[0] as f64 - 1.) / 2.,
        (d[1] as f64 - 1.) / 2.,
        (d[2] as f64 - 1.) / 2.,
        1.,
    );
    let mut bounds = [[f64::INFINITY; 3], [f64::NEG_INFINITY; 3]];
    for x in [-0.5, d[0] as f64 - 0.5] {
        for y in [-0.5, d[1] as f64 - 0.5] {
            for z in [-0.5, d[2] as f64 - 0.5] {
                let p = m * Vector4::new(x, y, z, 1.);
                for i in 0..3 {
                    bounds[0][i] = bounds[0][i].min(p[i]);
                    bounds[1][i] = bounds[1][i].max(p[i]);
                }
            }
        }
    }
    let (min, max) = volume
        .range()
        .ok_or("Volume contains no displayable values")?;
    if !min.is_finite() || !max.is_finite() {
        return Err("Volume range is not finite".into());
    }
    Ok(BrowserVolume {
        id: handle.id.clone(),
        name: handle.name.clone(),
        dims: d[..3].to_vec(),
        frame_count: handle.num_timepoints.unwrap_or(1),
        current_frame: handle.current_timepoint.unwrap_or(0),
        affine,
        center: [center.x, center.y, center.z],
        bounds,
        range: [min, max],
        label_ids: if handle.is_label_map == Some(true) {
            Some(
                volume
                    .values_contiguous()
                    .iter()
                    .map(|v| *v as u32)
                    .collect::<std::collections::BTreeSet<_>>()
                    .into_iter()
                    .collect(),
            )
        } else {
            None
        },
    })
}

/// Materialize only the selected spatial frame; the source remains the owner of all frames.
pub fn spatial_frame(
    data: &VolumeSendable,
    timepoint: usize,
) -> Result<std::borrow::Cow<'_, DenseVolume3<f32>>, String> {
    if let VolumeSendable::VolF32(volume, _) = data {
        return Ok(std::borrow::Cow::Borrowed(volume));
    }
    use volmath::NeuroSpaceExt;
    let frame =
        volume_service::frames::extract_frame(data, timepoint).map_err(|e| e.to_string())?;
    let space =
        volmath::NeuroSpace::from_affine_matrix4(frame.dims.to_vec(), *frame.affine.matrix())
            .map_err(|e| e.to_string())?;
    Ok(std::borrow::Cow::Owned(DenseVolume3::from_data(
        space,
        frame.values.into_owned(),
    )))
}
