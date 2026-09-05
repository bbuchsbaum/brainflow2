//! Choose a real voxel in each parcel, nearest its world-space centroid.
//! A centroid itself may be outside a concave or disconnected ROI.
use crate::parcel_overlay::input;
use crate::{BridgeResult, VolumeSendable};
use atlases::parcel_dictionary::ParcelDictionary;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AtlasRoiLocation {
    pub id: u32,
    pub name: String,
    pub hemisphere: Option<String>,
    pub network: Option<String>,
    pub world_mm: Option<[f64; 3]>,
    pub voxel_count: usize,
}

pub fn locations(
    dictionary: &ParcelDictionary,
    volume: &VolumeSendable,
) -> BridgeResult<Vec<AtlasRoiLocation>> {
    let dims = crate::get_spatial_dims_from_volume(volume);
    let affine = crate::get_affine_from_volume(volume)?;
    let values = crate::volume_data_as_f32_for_projection(volume)?;
    locate(
        dictionary,
        &values,
        [dims[0], dims[1], dims[2]],
        affine.to_homogeneous(),
    )
}

fn locate(
    dictionary: &ParcelDictionary,
    values: &[f32],
    dims: [usize; 3],
    affine: nalgebra::Matrix4<f32>,
) -> BridgeResult<Vec<AtlasRoiLocation>> {
    let index: HashMap<u32, usize> = dictionary
        .labels
        .iter()
        .enumerate()
        .map(|(i, l)| (l.id, i))
        .collect();
    if index.is_empty() || index.len() != dictionary.labels.len() || index.contains_key(&0) {
        return Err(input(
            "Atlas dictionary must contain unique nonzero parcel IDs",
        ));
    }
    if !affine.iter().all(|value| value.is_finite()) {
        return Err(input("Atlas affine is not finite"));
    }
    if dims.contains(&0)
        || dims.iter().try_fold(1usize, |n, &d| n.checked_mul(d)) != Some(values.len())
    {
        return Err(input("Atlas dimensions do not match its data"));
    }
    let affine = affine.cast::<f64>();
    let world = |i: usize| {
        let point = affine
            * nalgebra::Vector4::new(
                (i % dims[0]) as f64,
                ((i / dims[0]) % dims[1]) as f64,
                (i / (dims[0] * dims[1])) as f64,
                1.0,
            );
        [point[0], point[1], point[2]]
    };
    let mut sums = vec![[0.0; 3]; index.len()];
    let mut count = vec![0usize; index.len()];
    for (i, &value) in values.iter().enumerate() {
        if value == 0.0 {
            continue;
        }
        let parcel = index
            .get(&(value as u32))
            .filter(|_| value.is_finite() && value.fract() == 0.0 && value > 0.0)
            .ok_or_else(|| input("Atlas contains a voxel code outside its dictionary"))?;
        let point = world(i);
        for axis in 0..3 {
            sums[*parcel][axis] += point[axis];
        }
        count[*parcel] += 1;
    }
    for (i, sum) in sums.iter_mut().enumerate() {
        if count[i] > 0 {
            for value in sum {
                *value /= count[i] as f64;
            }
        }
    }
    let mut distance = vec![f64::INFINITY; index.len()];
    let mut points = vec![None; index.len()];
    for (i, &value) in values.iter().enumerate() {
        if value == 0.0 {
            continue;
        }
        let parcel = index[&(value as u32)];
        let point = world(i);
        let d: f64 = (0..3)
            .map(|axis| (point[axis] - sums[parcel][axis]).powi(2))
            .sum();
        if d < distance[parcel] {
            distance[parcel] = d;
            points[parcel] = Some(point);
        }
    }
    let mut rois: Vec<_> = dictionary
        .labels
        .iter()
        .enumerate()
        .map(|(i, label)| AtlasRoiLocation {
            id: label.id,
            name: dictionary
                .full_labels
                .as_ref()
                .and_then(|names| names.get(i))
                .unwrap_or(&label.name)
                .clone(),
            hemisphere: label.hemisphere.map(|h| h.as_str().to_owned()),
            network: label.network.as_ref().map(|n| n.name.clone()),
            world_mm: points[i],
            voxel_count: count[i],
        })
        .collect();
    rois.sort_by_key(|r| r.id);
    Ok(rois)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn navigation_stays_inside_disconnected_roi_and_preserves_oblique_world_affine() {
        let dictionary = ParcelDictionary {
            name: "test".into(),
            labels: [2, 9, 42]
                .into_iter()
                .map(|id| neuroatlas::Label {
                    id,
                    name: format!("ROI {id}"),
                    hemisphere: None,
                    network: None,
                    color: None,
                })
                .collect(),
            full_labels: None,
        };
        // ID 2 at opposite corners: its centroid [1,1,0] is background.
        let values = [2., 0., 9., 0., 0., 0., 0., 0., 2.];
        let affine = nalgebra::Matrix4::new(
            0., -2., 0., 10., 3., 0., 0., -4., 0., 0., 4., 7., 0., 0., 0., 1.,
        );
        let rois = locate(&dictionary, &values, [3, 3, 1], affine).unwrap();
        assert_eq!(rois[0].world_mm, Some([10., -4., 7.]));
        assert_eq!(rois[0].voxel_count, 2);
        assert_eq!(rois[1].world_mm, Some([10., 2., 7.]));
        assert_eq!(rois[2].world_mm, None);
        assert!(locate(&dictionary, &[3.], [1, 1, 1], affine).is_err());
    }
}
