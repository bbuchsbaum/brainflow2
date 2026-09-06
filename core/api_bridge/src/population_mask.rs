//! Explicit common binary support for population images and sampled probes.
//! Prepared bits are query-owned; the decoded source uses the existing bounded cache.
use crate::{
    population_sampling::SampleCancellation, set_sample_cache::SampleSourceRevision, BridgeState,
};
use bridge_types::{BridgeError, BridgeResult, VolumeSendable};
use nalgebra::Matrix4;
use std::{path::PathBuf, sync::Arc};

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaskSource {
    pub source_path: String,
    #[serde(default)]
    pub expected_sha256: Option<String>,
}

pub struct PreparedMask {
    dimensions: Vec<usize>,
    affine: Matrix4<f32>,
    bits: Vec<u8>,
    pub revision: SampleSourceRevision,
    _permit: Option<tokio::sync::OwnedSemaphorePermit>,
}
fn input(message: &str) -> BridgeError {
    BridgeError::Input {
        code: 2025,
        details: message.into(),
    }
}
impl PreparedMask {
    pub fn prepare(
        volume: &VolumeSendable,
        revision: SampleSourceRevision,
        expected: Option<&str>,
        token: &SampleCancellation,
    ) -> BridgeResult<Self> {
        if expected.is_some_and(|expected| expected != revision.sha256) {
            return Err(input("The frozen population mask revision changed."));
        }
        if crate::stack_length_for_volume(volume) != 1 {
            return Err(input("A population mask must have one spatial frame."));
        }
        let dimensions = crate::get_spatial_dims_from_volume(volume);
        let affine = *crate::get_affine_from_volume(volume)?.matrix();
        if dimensions.len() != 3
            || dimensions.contains(&0)
            || !affine.iter().all(|v| v.is_finite())
            || affine.try_inverse().is_none()
        {
            return Err(input(
                "A population mask needs a finite invertible spatial grid.",
            ));
        }
        let count = dimensions
            .iter()
            .try_fold(1usize, |count, &n| count.checked_mul(n))
            .ok_or_else(|| input("Population mask dimensions overflow."))?;
        if count > 32 * 1024 * 1024 * 8 {
            return Err(input(
                "The population mask exceeds its 32 MiB prepared-bit budget.",
            ));
        }
        let mut bits = vec![0u8; count.div_ceil(8)];
        for index in 0..count {
            if index % 4096 == 0 {
                token.check()?;
            }
            let x = index % dimensions[0];
            let y = (index / dimensions[0]) % dimensions[1];
            let z = index / (dimensions[0] * dimensions[1]);
            let value = crate::read_member_frame_at_voxel(volume, x, y, z, 0).unwrap_or(f32::NAN);
            if value != 0.0 && value != 1.0 {
                return Err(input("A population mask must contain only finite binary values 0 and 1; threshold or binarize it explicitly first."));
            }
            if value == 1.0 {
                bits[index / 8] |= 1 << (index % 8);
            }
        }
        Ok(Self {
            dimensions,
            affine,
            bits,
            revision,
            _permit: None,
        })
    }
    pub fn validate_grid(&self, volume: &VolumeSendable) -> BridgeResult<()> {
        let affine = crate::get_affine_from_volume(volume)?;
        if self.dimensions != crate::get_spatial_dims_from_volume(volume)
            || affine
                .matrix()
                .iter()
                .zip(self.affine.iter())
                .any(|(a, b)| !a.is_finite() || (a - b).abs() > 1e-5)
        {
            return Err(input("Population mask and observations must have identical voxel grids and world affines; resample explicitly first."));
        }
        Ok(())
    }
    pub fn includes(&self, x: usize, y: usize, z: usize) -> bool {
        if x >= self.dimensions[0] || y >= self.dimensions[1] || z >= self.dimensions[2] {
            return false;
        }
        let index = x + self.dimensions[0] * (y + self.dimensions[1] * z);
        self.bits[index / 8] & (1 << (index % 8)) != 0
    }
}
pub async fn prepare_mask(
    source: &MaskSource,
    path: PathBuf,
    state: &BridgeState,
    token: &SampleCancellation,
) -> BridgeResult<Arc<PreparedMask>> {
    // Admit before acquiring the decoded-source worker. A prepared mask retains
    // this permit through its query, bounding process-wide bit storage to 32 MiB.
    static ADMISSION: std::sync::OnceLock<Arc<tokio::sync::Semaphore>> = std::sync::OnceLock::new();
    let admission = Arc::clone(ADMISSION.get_or_init(|| Arc::new(tokio::sync::Semaphore::new(1))));
    let permit = tokio::select! {
        _ = token.cancelled() => return Err(crate::population_sampling::cancelled()),
        permit = admission.acquire_owned() => permit.map_err(|_| input("Population mask admission is closed."))?,
    };
    let expected = source.expected_sha256.clone();
    let check = token.clone();
    state
        .set_sample_cache
        .with_volume_cancelable(path, token.clone(), move |volume, revision| {
            let mut mask =
                PreparedMask::prepare(volume, revision.clone(), expected.as_deref(), &check)?;
            mask._permit = Some(permit);
            Ok(Arc::new(mask))
        })
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::set_sample_cache::TestSource;

    #[tokio::test]
    async fn population_mask_admission_is_cancelable_and_released_with_last_owner() {
        let source = TestSource::new(&[2, 2, 2], &[1.; 8]);
        let spec = MaskSource {
            source_path: source.path.to_string_lossy().into_owned(),
            expected_sha256: None,
        };
        let state = BridgeState::default().unwrap();
        let first = prepare_mask(
            &spec,
            source.path.clone(),
            &state,
            &SampleCancellation::default(),
        )
        .await
        .unwrap();
        let owner = first.clone();
        drop(first);
        let cancellation = SampleCancellation::default();
        let pending = prepare_mask(&spec, source.path.clone(), &state, &cancellation);
        tokio::pin!(pending);
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(10), &mut pending)
                .await
                .is_err()
        );
        cancellation.cancel();
        assert!(
            tokio::time::timeout(std::time::Duration::from_secs(1), &mut pending)
                .await
                .unwrap()
                .is_err()
        );
        drop(owner);
        let next = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            prepare_mask(
                &spec,
                source.path.clone(),
                &state,
                &SampleCancellation::default(),
            ),
        )
        .await
        .unwrap()
        .unwrap();
        assert!(next.includes(1, 1, 1));
        assert!(!next.includes(2, 0, 0));
    }
}
