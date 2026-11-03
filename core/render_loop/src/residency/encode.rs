//! Encoding a volume into texture bytes for one of the stored formats.

use crate::RenderLoopError;
use log::warn;
use serde::Serialize;
use volmath::{DataRange, DenseVolume3, VoxelData};

/// Storage selection for a volume upload.
#[derive(Clone, Copy)]
pub(crate) enum UploadFormat {
    Automatic { preserve_labels: bool },
    Explicit(wgpu::TextureFormat),
}

pub(crate) fn conversion_error(details: &str) -> RenderLoopError {
    RenderLoopError::Internal {
        code: 6007,
        details: details.into(),
    }
}

pub(crate) fn encode_volume<T>(
    volume: &DenseVolume3<T>,
    format: wgpu::TextureFormat,
) -> Result<Vec<u8>, RenderLoopError>
where
    T: VoxelData + num_traits::NumCast + DataRange<T> + Serialize,
{
    match format {
        wgpu::TextureFormat::R8Unorm => convert_to_r8unorm(volume),
        wgpu::TextureFormat::R16Float => convert_to_r16float(volume),
        wgpu::TextureFormat::R32Float => convert_to_r32float(volume),
        _ => Err(RenderLoopError::UnsupportedVolumeFormat(
            volume.voxel_type(),
        )),
    }
}

// The common half-precision case validates and encodes each voxel once. A
// rare precision fallback retries the whole volume, validating every label.
pub(crate) fn encode_with_policy<T>(
    volume: &DenseVolume3<T>,
    policy: UploadFormat,
) -> Result<(wgpu::TextureFormat, Vec<u8>), RenderLoopError>
where
    T: VoxelData + num_traits::NumCast + DataRange<T> + Serialize,
{
    let preserve_labels = match policy {
        UploadFormat::Explicit(format) => return Ok((format, encode_volume(volume, format)?)),
        UploadFormat::Automatic { preserve_labels } => preserve_labels,
    };
    let values = volume.values_contiguous();
    let mut bytes = Vec::with_capacity(values.len() * 2);
    for &original in values.iter() {
        let value = checked_automatic_value(original, preserve_labels)?;
        let half = half::f16::from_f32(value);
        let rounded = half.to_f32();
        if value.is_finite()
            && (!rounded.is_finite()
                || (value != 0.0 && rounded == 0.0)
                || (preserve_labels && rounded != value))
        {
            // Do not retain the abandoned half buffer alongside the full one.
            drop(bytes);
            return Ok((
                wgpu::TextureFormat::R32Float,
                encode_automatic_r32(volume, preserve_labels)?,
            ));
        }
        bytes.extend_from_slice(&half.to_ne_bytes());
    }
    Ok((wgpu::TextureFormat::R16Float, bytes))
}

fn checked_automatic_value<T: num_traits::NumCast + Copy + PartialEq>(
    original: T,
    preserve_labels: bool,
) -> Result<f32, RenderLoopError> {
    let value = voxel_as_f32(original)?;
    if preserve_labels && value.is_finite() && num_traits::cast::<f32, T>(value) != Some(original) {
        return Err(conversion_error(
            "Label cannot be represented exactly by R32Float",
        ));
    }
    Ok(value)
}

/// R32Float needs FLOAT32_FILTERABLE in the filterable slice layout. When
/// the adapter lacks it (`r32_unfilterable`), an *automatic* scalar upload
/// that was promoted to R32Float falls back to R16Float: magnitudes above the
/// f16 range clamp to ±65504 and values below its smallest subnormal flush
/// to zero, with a warning. Label-preserving and explicitly requested R32Float
/// uploads keep the error, because f16 cannot hold them exactly.
pub(crate) fn fit_filterable_format<T>(
    volume: &DenseVolume3<T>,
    policy: UploadFormat,
    format: wgpu::TextureFormat,
    data: Vec<u8>,
    r32_unfilterable: bool,
) -> Result<(wgpu::TextureFormat, Vec<u8>), RenderLoopError>
where
    T: VoxelData + num_traits::NumCast + DataRange<T> + Serialize,
{
    if !(r32_unfilterable && format == wgpu::TextureFormat::R32Float) {
        return Ok((format, data));
    }
    if !matches!(
        policy,
        UploadFormat::Automatic {
            preserve_labels: false
        }
    ) {
        return Err(conversion_error(
            "R32Float requires FLOAT32_FILTERABLE for the active slice texture layout",
        ));
    }
    drop(data);
    let (bytes, clamped, flushed) = encode_r16_lossy(volume)?;
    warn!(
        "Adapter lacks FLOAT32_FILTERABLE: volume uploaded as R16Float instead of R32Float \
         ({clamped} voxels clamped to ±65504, {flushed} flushed to zero)"
    );
    Ok((wgpu::TextureFormat::R16Float, bytes))
}

/// Lossy R16Float encoding: clamp finite magnitudes to ±65504; values too
/// small for f16 flush to zero. Returns (bytes, clamped, flushed).
fn encode_r16_lossy<T>(volume: &DenseVolume3<T>) -> Result<(Vec<u8>, usize, usize), RenderLoopError>
where
    T: VoxelData + num_traits::NumCast + DataRange<T> + Serialize,
{
    let values = volume.values_contiguous();
    let mut bytes = Vec::with_capacity(values.len() * 2);
    let (mut clamped, mut flushed) = (0usize, 0usize);
    let max = half::f16::MAX.to_f32();
    for &original in values.iter() {
        let mut value = voxel_as_f32(original)?;
        if value.is_finite() && value.abs() > max {
            value = value.clamp(-max, max);
            clamped += 1;
        }
        let half = half::f16::from_f32(value);
        if value != 0.0 && value.is_finite() && half.to_f32() == 0.0 {
            flushed += 1;
        }
        bytes.extend_from_slice(&half.to_ne_bytes());
    }
    Ok((bytes, clamped, flushed))
}

pub(crate) fn encode_automatic_r32<T>(
    volume: &DenseVolume3<T>,
    preserve_labels: bool,
) -> Result<Vec<u8>, RenderLoopError>
where
    T: VoxelData + num_traits::NumCast + DataRange<T> + Serialize,
{
    let values = volume.values_contiguous();
    let mut bytes = Vec::with_capacity(values.len() * 4);
    for &original in values.iter() {
        bytes.extend_from_slice(&checked_automatic_value(original, preserve_labels)?.to_ne_bytes());
    }
    Ok(bytes)
}

fn voxel_as_f32<T: num_traits::NumCast + Copy>(value: T) -> Result<f32, RenderLoopError> {
    let original = num_traits::cast::<T, f64>(value)
        .ok_or_else(|| conversion_error("Cannot convert voxel to f64"))?;
    let value = num_traits::cast::<T, f32>(value)
        .ok_or_else(|| conversion_error("Cannot convert voxel to f32"))?;
    if original.is_finite() && (!value.is_finite() || (original != 0.0 && value == 0.0)) {
        return Err(conversion_error(
            "Voxel exceeds the finite nonzero range supported by R32Float",
        ));
    }
    Ok(value)
}

// Helper functions for data conversion

fn convert_to_r8unorm<T>(volume: &DenseVolume3<T>) -> Result<Vec<u8>, RenderLoopError>
where
    T: VoxelData + num_traits::NumCast + DataRange<T> + Serialize,
{
    // R8Unorm is an explicitly requested, range-normalized display format.
    // Cast BEFORE arithmetic: integer division otherwise collapses the contrast.
    let values = volume.values_contiguous();
    let mut min = f64::INFINITY;
    let mut max = f64::NEG_INFINITY;
    for &value in values.iter() {
        let value = num_traits::cast::<T, f64>(value)
            .ok_or_else(|| conversion_error("Cannot convert voxel to f64"))?;
        if !value.is_finite() {
            return Err(conversion_error(
                "R8Unorm cannot preserve non-finite voxels; use a float format",
            ));
        }
        min = min.min(value);
        max = max.max(value);
    }
    if values.is_empty() {
        return Err(conversion_error("Cannot upload an empty volume"));
    }
    let range = max - min;
    if !range.is_finite() {
        return Err(conversion_error(
            "R8Unorm normalization range is not finite",
        ));
    }
    Ok(values
        .iter()
        .map(|&value| {
            let value = num_traits::cast::<T, f64>(value).unwrap();
            if range > 0.0 {
                (((value - min) / range) * 255.0).round() as u8
            } else {
                0
            }
        })
        .collect())
}

fn convert_to_r16float<T>(volume: &DenseVolume3<T>) -> Result<Vec<u8>, RenderLoopError>
where
    T: VoxelData + num_traits::NumCast + DataRange<T> + Serialize,
{
    // Single pass: cast each voxel f32 -> f16 and append its 2 bytes directly,
    // into a pre-sized buffer. Avoids the intermediate Vec<f16> allocation and
    // the per-element flat_map of the old two-step version. Byte-for-byte
    // identical output (see test convert_to_r16float_matches_reference).
    // values_contiguous() borrows the backing buffer (no rebuild) for the
    // Fortran-laid-out volumes that reach the GPU.
    let values = volume.values_contiguous();
    let mut bytes = Vec::with_capacity(values.len() * 2);
    for &val in values.iter() {
        let f32_val = voxel_as_f32(val)?;
        let half = half::f16::from_f32(f32_val);
        if f32_val.is_finite() && (!half.is_finite() || (f32_val != 0.0 && half.to_f32() == 0.0)) {
            return Err(conversion_error(
                "R16Float would overflow or erase a finite nonzero voxel; use R32Float",
            ));
        }
        bytes.extend_from_slice(&half.to_ne_bytes());
    }
    Ok(bytes)
}

fn convert_to_r32float<T>(volume: &DenseVolume3<T>) -> Result<Vec<u8>, RenderLoopError>
where
    T: VoxelData + num_traits::NumCast + DataRange<T> + Serialize,
{
    // Single pass into a pre-sized buffer (see convert_to_r16float).
    let values = volume.values_contiguous();
    let mut bytes = Vec::with_capacity(values.len() * 4);
    for &val in values.iter() {
        let f32_val = voxel_as_f32(val)?;
        bytes.extend_from_slice(&f32_val.to_ne_bytes());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use volmath::NeuroSpaceExt;

    #[test]
    fn normalized_u8_conversion_retains_intermediate_levels() {
        use volmath::{NeuroSpace, NeuroSpaceExt};
        let space =
            NeuroSpace::from_dims_spacing_origin(vec![3, 1, 1], vec![1.; 3], vec![0.; 3]).unwrap();
        let volume = DenseVolume3::from_data(space, vec![32u8, 64, 96]);
        assert_eq!(convert_to_r8unorm(&volume).unwrap(), [0, 128, 255]);
        assert_eq!(
            encode_with_policy(
                &volume,
                UploadFormat::Automatic {
                    preserve_labels: false
                }
            )
            .unwrap()
            .0,
            wgpu::TextureFormat::R16Float
        );
    }

    #[test]
    fn normalized_range_overflow_is_rejected() {
        use volmath::{NeuroSpace, NeuroSpaceExt};
        let space =
            NeuroSpace::from_dims_spacing_origin(vec![2, 1, 1], vec![1.; 3], vec![0.; 3]).unwrap();
        let volume = DenseVolume3::from_data(space, vec![-1e308f64, 1e308]);
        assert!(convert_to_r8unorm(&volume).is_err());
    }

    #[test]
    fn default_precision_preserves_finite_range_and_label_identity() {
        use volmath::{NeuroSpace, NeuroSpaceExt};
        let space =
            NeuroSpace::from_dims_spacing_origin(vec![1; 3], vec![1.; 3], vec![0.; 3]).unwrap();
        for value in [70_000f32, -70_000., 1e-9] {
            let volume = DenseVolume3::from_data(space.clone(), vec![value]);
            assert_eq!(
                encode_with_policy(
                    &volume,
                    UploadFormat::Automatic {
                        preserve_labels: false
                    }
                )
                .unwrap()
                .0,
                wgpu::TextureFormat::R32Float
            );
            assert!(convert_to_r16float(&volume).is_err());
            assert_eq!(convert_to_r32float(&volume).unwrap(), value.to_ne_bytes());
        }
        let label = DenseVolume3::from_data(space.clone(), vec![2049u16]);
        assert_eq!(
            encode_with_policy(
                &label,
                UploadFormat::Automatic {
                    preserve_labels: true
                }
            )
            .unwrap()
            .0,
            wgpu::TextureFormat::R32Float
        );
        let label32 = DenseVolume3::from_data(space.clone(), vec![16_777_217u32]);
        assert!(encode_with_policy(
            &label32,
            UploadFormat::Automatic {
                preserve_labels: true
            }
        )
        .is_err());
        let overflow = DenseVolume3::from_data(space, vec![1e100f64]);
        assert!(convert_to_r32float(&overflow).is_err());
    }

    #[test]
    fn unfilterable_r32_falls_back_to_lossy_r16_for_scalars_only() {
        use volmath::{NeuroSpace, NeuroSpaceExt};
        let space =
            NeuroSpace::from_dims_spacing_origin(vec![3, 1, 1], vec![1.; 3], vec![0.; 3]).unwrap();
        // 1e6 overflows f16 and 1e-9 underflows it: automatic encoding promotes.
        let volume = DenseVolume3::from_data(space.clone(), vec![1e6f32, 1e-9, 3.0]);
        let scalar = UploadFormat::Automatic {
            preserve_labels: false,
        };
        let (format, bytes) = encode_with_policy(&volume, scalar).unwrap();
        assert_eq!(format, wgpu::TextureFormat::R32Float);
        // Filterable adapter: R32Float is kept.
        let kept = fit_filterable_format(&volume, scalar, format, bytes.clone(), false).unwrap();
        assert_eq!(kept.0, wgpu::TextureFormat::R32Float);
        // Unfilterable adapter: R16Float with clamp and flush.
        let (format, bytes) = fit_filterable_format(&volume, scalar, format, bytes, true).unwrap();
        assert_eq!(format, wgpu::TextureFormat::R16Float);
        let decoded: Vec<f32> = bytes
            .chunks_exact(2)
            .map(|b| half::f16::from_ne_bytes([b[0], b[1]]).to_f32())
            .collect();
        assert_eq!(decoded, vec![65504.0, 0.0, 3.0]);
        // Labels and explicit R32Float keep the error.
        let labels = DenseVolume3::from_data(space, vec![1u32, 2049, 7]);
        let label_policy = UploadFormat::Automatic {
            preserve_labels: true,
        };
        let (format, bytes) = encode_with_policy(&labels, label_policy).unwrap();
        assert!(fit_filterable_format(&labels, label_policy, format, bytes, true).is_err());
        let explicit = UploadFormat::Explicit(wgpu::TextureFormat::R32Float);
        let (format, bytes) = encode_with_policy(&volume, explicit).unwrap();
        assert!(fit_filterable_format(&volume, explicit, format, bytes, true).is_err());
    }

    #[test]
    fn automatic_encoding_retries_and_checks_all_labels() {
        use volmath::{NeuroSpace, NeuroSpaceExt};
        let space =
            NeuroSpace::from_dims_spacing_origin(vec![3, 1, 1], vec![1.; 3], vec![0.; 3]).unwrap();
        let volume = DenseVolume3::from_data(space.clone(), vec![1u32, 2049, 7]);
        let (format, bytes) = encode_with_policy(
            &volume,
            UploadFormat::Automatic {
                preserve_labels: true,
            },
        )
        .unwrap();
        assert_eq!(format, wgpu::TextureFormat::R32Float);
        let expected: Vec<u8> = [1f32, 2049., 7.]
            .iter()
            .flat_map(|value| value.to_ne_bytes())
            .collect();
        assert_eq!(bytes, expected);
        let invalid = DenseVolume3::from_data(space, vec![1u32, 2049, 16_777_217]);
        assert!(encode_with_policy(
            &invalid,
            UploadFormat::Automatic {
                preserve_labels: true
            }
        )
        .is_err());
    }

    #[test]
    fn convert_to_r16float_matches_reference() {
        use volmath::space::{NeuroSpace3, NeuroSpaceImpl};

        let dims = [2usize, 3, 4];
        let n = dims[0] * dims[1] * dims[2];
        // Distinct values including fractions and a negative, to exercise the
        // f32 -> f16 rounding and the byte layout.
        let data: Vec<f32> = (0..n).map(|i| (i as f32) * 0.5 - 3.0).collect();
        let voxel_to_world = nalgebra::Matrix4::<f32>::identity();
        let space_impl =
            NeuroSpaceImpl::from_affine_matrix4(dims.to_vec(), voxel_to_world).unwrap();
        let space = NeuroSpace3::new(space_impl);
        let vol = DenseVolume3::from_data(space.0, data);

        // Reference = the original two-step algorithm this commit collapses.
        let reference: Vec<u8> = vol
            .values()
            .iter()
            .map(|&v| half::f16::from_f32(v))
            .flat_map(|h| h.to_ne_bytes())
            .collect();

        let actual = convert_to_r16float(&vol).expect("convert");
        assert_eq!(actual, reference, "single-pass output must match reference");
        assert_eq!(actual.len(), n * 2);
    }
}
