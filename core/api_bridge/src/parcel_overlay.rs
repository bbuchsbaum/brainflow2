//! Validated parcel tables. Geometry is shared by Arc; each overlay owns its
//! volume handle, GPU lease, retained table and small RGBA lookup row.
#[cfg(test)]
use crate::VolumeRegistry;
use crate::{BridgeError, BridgeResult, VolumeEntry};
use atlases::parcel_dictionary::ParcelDictionary;
use neuroatlas::{ParcelCoverage, ParcelData, ParcelJoinKey, ParcelValueRow};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    sync::Arc,
};
use ts_rs::TS;

pub fn input(message: impl Into<String>) -> BridgeError {
    BridgeError::Input {
        code: 6450,
        details: message.into(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ParcelTableRequest {
    pub source_volume_id: String,
    pub text: String,
    // Explicit delimiter. No guessing inside quoted fields.
    pub delimiter: String,
    pub key_column: Option<String>,
    // id, label, full_label, label_hemi, label_hemi_network
    pub key_kind: String,
    pub hemisphere_column: Option<String>,
    pub network_column: Option<String>,
    pub allow_partial: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ParcelColumnInfo {
    pub name: String,
    pub range: Option<[f32; 2]>,
    pub finite_count: usize,
    pub missing_count: usize,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ParcelTablePreview {
    pub atlas_name: String,
    pub atlas_parcels: usize,
    pub headers: Vec<String>,
    pub columns: Vec<ParcelColumnInfo>,
    pub row_count: usize,
    pub matched_parcels: usize,
    pub missing_parcels: usize,
    pub binding_error: Option<String>,
    pub key_examples: Vec<String>,
    pub dictionary_sha256: String,
    pub table_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ParcelOverlayInfo {
    pub volume_id: String,
    pub table_name: String,
    pub source_volume_id: String,
    pub selected_column: String,
    pub preview: ParcelTablePreview,
}

#[derive(Debug, Clone)]
pub struct ParcelOverlay {
    pub geometry: Arc<bridge_types::VolumeSendable>,
    pub revision: u64,
    pub info: ParcelOverlayInfo,
    /// Canonical label code -> value for each validated numeric column.
    columns: BTreeMap<String, Vec<Option<f32>>>,
}

impl ParcelOverlay {
    /// CPU readers receive the selected statistic, never the stored label codes.
    /// Only GPU upload uses `geometry`; column switches rebuild this CPU snapshot
    /// and update the small GPU lookup row without re-uploading atlas geometry.
    pub fn scalar_snapshot(&self) -> BridgeResult<bridge_types::VolumeSendable> {
        use volmath::NeuroSpaceExt;
        let affine = crate::get_affine_from_volume(&self.geometry)?;
        let dims = crate::get_spatial_dims_from_volume(&self.geometry);
        let space = <volmath::NeuroSpace as NeuroSpaceExt>::from_affine_matrix4(
            dims.to_vec(),
            affine.to_homogeneous(),
        )
        .map_err(|e| input(e.to_string()))?;
        let data = crate::volume_data_as_f32_for_projection(&self.geometry)?
            .into_iter()
            .map(|label| self.sample(label))
            .collect();
        Ok(bridge_types::VolumeSendable::VolF32(
            volmath::DenseVolume3::from_data(space, data),
            affine,
        ))
    }

    pub fn sample(&self, label: f32) -> f32 {
        if !label.is_finite() || label <= 0.0 || label.fract() != 0.0 {
            return f32::NAN;
        }
        self.columns
            .get(&self.info.selected_column)
            .and_then(|values| values.get(label as usize))
            .copied()
            .flatten()
            .unwrap_or(f32::NAN)
    }

    pub fn select(&mut self, column: &str) -> BridgeResult<ParcelOverlayInfo> {
        if !self.columns.contains_key(column) {
            return Err(input("Select a valid numeric table column"));
        }
        self.info.selected_column = column.to_owned();
        self.revision += 1;
        Ok(self.info.clone())
    }

    pub fn lut(
        &self,
        colormap: &str,
        window: [f32; 2],
        hidden_range: Option<[f32; 2]>,
    ) -> BridgeResult<Vec<u8>> {
        let map = colormap::colormap_by_name(colormap)
            .ok_or_else(|| input("Unknown overlay colormap"))?;
        if !window.iter().all(|v| v.is_finite()) || window[0] >= window[1] {
            return Err(input("Color limits must be finite and increasing"));
        }
        if hidden_range.is_some_and(|r| !r.iter().all(|v| v.is_finite()) || r[0] > r[1]) {
            return Err(input("Threshold limits must be finite and ordered"));
        }
        let gradient = colormap::colormap_data(map);
        let mut rgba = vec![0; render_loop::texture_manager::COLORMAP_LUT_WIDTH as usize * 4];
        for (id, value) in self.columns[&self.info.selected_column]
            .iter()
            .enumerate()
            .skip(1)
        {
            let Some(value) = value else { continue };
            if hidden_range.is_some_and(|r| *value >= r[0] && *value <= r[1]) {
                continue;
            }
            let t = ((*value as f64 - window[0] as f64) / (window[1] as f64 - window[0] as f64))
                .clamp(0.0, 1.0);
            let color = gradient[(t * 255.0).round() as usize];
            rgba[id * 4..id * 4 + 4].copy_from_slice(&[color[0], color[1], color[2], 255]);
        }
        Ok(rgba)
    }
}

struct ParsedTable {
    preview: ParcelTablePreview,
    columns: BTreeMap<String, Vec<Option<f32>>>,
}

fn parse_table(
    dictionary: &ParcelDictionary,
    req: &ParcelTableRequest,
) -> BridgeResult<ParsedTable> {
    if req.text.len() > 5 * 1024 * 1024 {
        return Err(input("Table exceeds the 5 MiB import limit"));
    }
    let delimiter = match req.delimiter.as_str() {
        "," => b',',
        "\t" => b'\t',
        _ => return Err(input("Select CSV or TSV")),
    };
    let mut reader = csv::ReaderBuilder::new().delimiter(delimiter).from_reader(
        req.text
            .strip_prefix('\u{feff}')
            .unwrap_or(&req.text)
            .as_bytes(),
    );
    let headers: Vec<String> = reader
        .headers()
        .map_err(|e| input(e.to_string()))?
        .iter()
        .map(str::to_owned)
        .collect();
    let mut unique = HashSet::new();
    if headers.is_empty()
        || headers.len() > 256
        || headers
            .iter()
            .any(|s| s.trim().is_empty() || !unique.insert(s))
    {
        return Err(input("Use 1–256 unique, nonempty column names"));
    }
    let records = reader
        .records()
        .take(100_001)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| input(e.to_string()))?;
    if records.is_empty() || records.len() > 100_000 {
        return Err(input("Table must contain 1–100,000 rows"));
    }
    let dictionary_bytes = serde_json::to_vec(&(
        1u32,
        &dictionary.name,
        &dictionary.labels,
        &dictionary.full_labels,
    ))
    .map_err(|e| input(e.to_string()))?;
    let mut preview = ParcelTablePreview {
        atlas_name: dictionary.name.clone(),
        atlas_parcels: dictionary.labels.len(),
        headers: headers.clone(),
        columns: vec![],
        row_count: records.len(),
        matched_parcels: 0,
        missing_parcels: dictionary.labels.len(),
        binding_error: None,
        key_examples: dictionary
            .labels
            .iter()
            .enumerate()
            .take(5)
            .map(|(i, label)| {
                format!(
                    "{} · {}{}",
                    label.id,
                    dictionary
                        .full_labels
                        .as_ref()
                        .and_then(|v| v.get(i))
                        .unwrap_or(&label.name),
                    label
                        .hemisphere
                        .map(|h| format!(" · {}", h.as_str()))
                        .unwrap_or_default()
                )
            })
            .collect(),
        dictionary_sha256: format!("{:x}", Sha256::digest(dictionary_bytes)),
        table_sha256: format!("{:x}", Sha256::digest(req.text.as_bytes())),
    };
    let index = |name: &str| {
        headers
            .iter()
            .position(|s| s == name)
            .ok_or_else(|| input(format!("Unknown column: {name}")))
    };
    let bind = || -> BridgeResult<ParcelData> {
        let key_col = index(
            req.key_column
                .as_deref()
                .ok_or_else(|| input("Choose a parcel key column"))?,
        )?;
        let hemi_col = req.hemisphere_column.as_deref().map(index).transpose()?;
        let network_col = req.network_column.as_deref().map(index).transpose()?;
        let key = match req.key_kind.as_str() {
            "id" => ParcelJoinKey::Id,
            "label" => ParcelJoinKey::Label,
            "full_label" => ParcelJoinKey::FullLabel,
            "label_hemi" => ParcelJoinKey::LabelHemisphere,
            "label_hemi_network" => ParcelJoinKey::LabelHemisphereNetwork,
            _ => return Err(input("Unknown parcel key type")),
        };
        let mut used_columns = HashSet::new();
        if [Some(key_col), hemi_col, network_col]
            .into_iter()
            .flatten()
            .any(|c| !used_columns.insert(c))
        {
            return Err(input(
                "Key, hemisphere and network must use different columns",
            ));
        }
        let rows = records
            .iter()
            .enumerate()
            .map(|(i, record)| {
                let values = BTreeMap::from([("source_row".to_owned(), serde_json::json!(i))]);
                let mut row = if key == ParcelJoinKey::Id {
                    let id = record[key_col].parse::<u32>().map_err(|_| {
                        input(format!(
                            "Row {}: parcel ID must be an unsigned integer",
                            i + 1
                        ))
                    })?;
                    if id.to_string() != record[key_col] {
                        return Err(input(format!(
                            "Row {}: use canonical integer IDs without padding or whitespace",
                            i + 1
                        )));
                    }
                    ParcelValueRow::by_id(id, values)
                } else {
                    ParcelValueRow::by_label(&record[key_col], values)
                };
                if let Some(col) = hemi_col {
                    row.hemi = Some(match &record[col] {
                        "left" => neuroatlas::Hemisphere::Left,
                        "right" => neuroatlas::Hemisphere::Right,
                        "both" => neuroatlas::Hemisphere::Bilateral,
                        _ => {
                            return Err(input(format!(
                                "Row {}: hemisphere must be left, right or both",
                                i + 1
                            )))
                        }
                    });
                }
                row.network = network_col.map(|col| record[col].to_owned());
                Ok(row)
            })
            .collect::<BridgeResult<Vec<_>>>()?;
        ParcelData::from_atlas_with_rows_and_coverage(
            dictionary,
            &rows,
            key,
            if req.allow_partial {
                ParcelCoverage::AllowPartial
            } else {
                ParcelCoverage::Complete
            },
        )
        .map_err(|e| input(e.to_string()))
    };
    let bound = match bind() {
        Ok(data) => {
            preview.matched_parcels = records.len();
            preview.missing_parcels = dictionary.labels.len() - records.len();
            Some(data)
        }
        Err(e) => {
            preview.binding_error = Some(e.to_string());
            None
        }
    };
    let max_id = dictionary.labels.iter().map(|l| l.id).max().unwrap_or(0) as usize;
    if dictionary.labels.is_empty()
        || max_id >= render_loop::texture_manager::COLORMAP_LUT_WIDTH as usize
        || dictionary.labels.iter().any(|l| l.id == 0)
    {
        return Err(input(
            "This atlas does not have a supported discrete parcel dictionary (IDs 1–2047)",
        ));
    }
    let mut columns = BTreeMap::new();
    for (col, name) in headers.iter().enumerate() {
        if [
            req.key_column.as_ref(),
            req.hemisphere_column.as_ref(),
            req.network_column.as_ref(),
        ]
        .contains(&Some(name))
        {
            continue;
        }
        let mut info = ParcelColumnInfo {
            name: name.clone(),
            range: None,
            finite_count: 0,
            missing_count: 0,
            error: None,
        };
        let mut values = Vec::with_capacity(records.len());
        for (i, record) in records.iter().enumerate() {
            let cell = record[col].trim();
            if matches!(cell, "" | "NA" | "null") {
                info.missing_count += 1;
                values.push(None);
                continue;
            }
            match cell.parse::<f64>() {
                Ok(v)
                    if v.is_finite() && (v as f32).is_finite() && (v == 0.0 || v as f32 != 0.0) =>
                {
                    let v = v as f32;
                    info.finite_count += 1;
                    info.range = Some(info.range.map_or([v, v], |r| [r[0].min(v), r[1].max(v)]));
                    values.push(Some(v));
                }
                _ => {
                    info.error.get_or_insert_with(|| {
                        format!("Row {} is not a finite displayable number", i + 1)
                    });
                    values.push(None);
                }
            }
        }
        if info.finite_count == 0 && info.error.is_none() {
            info.error = Some("Column has no numeric values".to_owned());
        }
        if let Some(data) = bound.as_ref().filter(|_| info.error.is_none()) {
            let mut aligned = vec![None; max_id + 1];
            for parcel in &data.parcels {
                if let Some(row) = parcel.values.get("source_row").and_then(|v| v.as_u64()) {
                    aligned[parcel.id as usize] = values[row as usize];
                }
            }
            columns.insert(name.clone(), aligned);
        }
        preview.columns.push(info);
    }
    Ok(ParsedTable { preview, columns })
}

pub fn preview_dictionary(
    dictionary: &ParcelDictionary,
    req: &ParcelTableRequest,
) -> BridgeResult<ParcelTablePreview> {
    Ok(parse_table(dictionary, req)?.preview)
}

pub fn prepare(
    dictionary: &ParcelDictionary,
    source: &VolumeEntry,
    req: &ParcelTableRequest,
    column: &str,
    table_name: String,
) -> BridgeResult<(VolumeEntry, ParcelOverlay)> {
    let parsed = parse_table(dictionary, req)?;
    if let Some(error) = parsed.preview.binding_error {
        return Err(input(error));
    }
    if !parsed.columns.contains_key(column) {
        return Err(input("Choose a valid numeric column"));
    }
    if source.metadata.volume_type != bridge_types::VolumeType::Volume3D {
        return Err(input("Parcel overlays require a discrete 3D atlas"));
    }
    let labels: HashSet<u32> = dictionary.labels.iter().map(|l| l.id).collect();
    let voxels = crate::volume_data_as_f32_for_projection(source.data.as_ref())?;
    if voxels.iter().any(|v| {
        !v.is_finite() || v.fract() != 0.0 || (*v != 0.0 && !labels.contains(&(*v as u32)))
    }) {
        return Err(input("Atlas image contains codes outside its parcel dictionary; probabilistic atlases are not supported"));
    }
    let id = format!("parcel_{}", uuid::Uuid::new_v4());
    let mut metadata = source.metadata.clone();
    metadata.name = table_name.clone();
    metadata.dtype = "float32".into();
    let info = ParcelOverlayInfo {
        volume_id: id.clone(),
        table_name,
        source_volume_id: req.source_volume_id.clone(),
        selected_column: column.to_owned(),
        preview: parsed.preview,
    };
    let overlay = ParcelOverlay {
        info,
        columns: parsed.columns,
        geometry: Arc::clone(&source.data),
        revision: 0,
    };
    let entry = VolumeEntry {
        data: Arc::new(overlay.scalar_snapshot()?),
        metadata,
        current_timepoint: None,
    };
    Ok((entry, overlay))
}

#[cfg(test)]
fn create(
    registry: &mut VolumeRegistry,
    req: &ParcelTableRequest,
    column: &str,
    table_name: String,
) -> BridgeResult<ParcelOverlayInfo> {
    let (entry, overlay) = prepare(
        registry
            .parcel_dictionaries
            .get(&req.source_volume_id)
            .unwrap(),
        registry.get_entry(&req.source_volume_id).unwrap(),
        req,
        column,
        table_name,
    )?;
    let info = overlay.info.clone();
    registry.volumes.insert(info.volume_id.clone(), entry);
    registry
        .parcel_overlays
        .insert(info.volume_id.clone(), overlay);
    Ok(info)
}

#[cfg(test)]
mod tests {
    use super::*;
    use neuroatlas::{Hemisphere, Label};
    use volmath::{DenseVolume3, NeuroSpaceExt};

    fn dictionary() -> ParcelDictionary {
        ParcelDictionary {
            name: "Test parcels".into(),
            labels: vec![
                Label::new(1, "Area").with_hemisphere(Hemisphere::Left),
                Label::new(7, "Area").with_hemisphere(Hemisphere::Right),
                Label::new(9, "Other").with_hemisphere(Hemisphere::Left),
            ],
            full_labels: Some(vec!["LH_Area".into(), "RH_Area".into(), "LH_Other".into()]),
        }
    }
    fn request(text: &str) -> ParcelTableRequest {
        ParcelTableRequest {
            source_volume_id: "atlas".into(),
            text: text.into(),
            delimiter: ",".into(),
            key_column: Some("id".into()),
            key_kind: "id".into(),
            hemisphere_column: None,
            network_column: None,
            allow_partial: false,
        }
    }
    fn registry(voxels: Vec<f32>) -> VolumeRegistry {
        let mut registry = VolumeRegistry::new();
        let space = <volmath::NeuroSpace as NeuroSpaceExt>::from_affine_matrix4(
            vec![voxels.len(), 1, 1],
            nalgebra::Matrix4::identity(),
        )
        .unwrap();
        let vol = DenseVolume3::from_data(space, voxels);
        registry.insert(
            "atlas".into(),
            bridge_types::VolumeSendable::VolF32(vol, nalgebra::Affine3::identity()),
            crate::VolumeMetadataInfo {
                name: "Atlas".into(),
                path: "atlas:test".into(),
                dtype: "float32".into(),
                volume_type: bridge_types::VolumeType::Volume3D,
                time_series_info: None,
            },
        );
        registry
            .parcel_dictionaries
            .insert("atlas".into(), dictionary());
        registry
    }
    #[test]
    fn parcel_table_permutation_missing_zero_negative_and_column_switch() {
        let mut registry = registry(vec![0., 1., 7., 9.]);
        let req = request("id,beta,t\n9,,2\n1,0,-4\n7,-2,8\n");
        let info = create(&mut registry, &req, "beta", "Stats".into()).unwrap();
        assert!(Arc::ptr_eq(
            &registry.get_arc("atlas").unwrap(),
            &registry.parcel_overlays[&info.volume_id].geometry
        ));
        let second = create(&mut registry, &req, "beta", "Second overlay".into()).unwrap();
        let scalar =
            crate::volume_data_as_f32_for_projection(registry.get(&info.volume_id).unwrap())
                .unwrap();
        assert!(scalar[0].is_nan());
        assert_eq!(&scalar[1..3], &[0., -2.]);
        assert!(scalar[3].is_nan());
        let overlay = registry.parcel_overlays.get_mut(&info.volume_id).unwrap();
        assert_eq!(overlay.sample(1.), 0.);
        assert_eq!(overlay.sample(7.), -2.);
        assert!(overlay.sample(9.).is_nan());
        assert!(overlay.sample(0.).is_nan());
        let lut = overlay.lut("gray", [-2., 2.], None).unwrap();
        assert_eq!(lut[7 * 4 + 3], 255);
        assert_eq!(lut[1 * 4 + 3], 255); // zero is opaque
        assert_eq!(lut[9 * 4 + 3], 0); // missing is transparent
        assert_eq!(lut[3], 0); // background stays transparent
        let hidden = overlay.lut("gray", [-2., 2.], Some([-0.1, 0.1])).unwrap();
        assert_eq!(hidden[1 * 4 + 3], 0);
        assert_eq!(hidden[7 * 4 + 3], 255); // threshold is numeric, not parcel ID
        overlay.select("t").unwrap();
        assert_eq!(overlay.sample(1.), -4.);
        assert_eq!(overlay.sample(7.), 8.);
        assert_eq!(overlay.sample(9.), 2.);
        assert_eq!(
            registry.parcel_overlays[&second.volume_id].sample(7.),
            -2.,
            "Column selection is per overlay"
        );
        registry.remove("atlas"); // owned snapshot survives source removal
        assert_eq!(registry.parcel_overlays[&info.volume_id].sample(7.), 8.);
        registry.remove(&info.volume_id);
        registry.remove(&second.volume_id);
        assert!(registry.parcel_overlays.is_empty());
    }
    #[test]
    fn parcel_table_rejects_bad_keys_headers_and_nonfinite_values() {
        for text in [
            "id,b\n1,2\n1,3\n9,4",
            "id,b\n1,2\n7,3\n99,4",
            "id,b\n1.0,2\n7,3\n9,4",
            "id,b\n 1,2\n7,3\n9,4",
        ] {
            let parsed = parse_table(&dictionary(), &request(text)).unwrap();
            assert!(parsed.preview.binding_error.is_some(), "{text}");
        }
        for text in ["id,b,b\n1,2,3", "id,b\n1,2,3"] {
            assert!(parse_table(&dictionary(), &request(text)).is_err());
        }
        for cell in ["NaN", "inf", "1e100", "1e-100", "bad"] {
            let req = request(&format!("id,b\n1,{cell}\n7,2\n9,3"));
            assert!(parse_table(&dictionary(), &req).unwrap().preview.columns[0]
                .error
                .is_some());
            assert!(create(&mut registry(vec![1., 7., 9.]), &req, "b", "bad".into()).is_err());
        }
    }
    #[test]
    fn parcel_table_full_and_composite_labels_and_explicit_partial() {
        let mut req = request("roi,b\nRH_Area,3\nLH_Area,2");
        req.key_kind = "full_label".into();
        req.key_column = Some("roi".into());
        assert!(parse_table(&dictionary(), &req)
            .unwrap()
            .preview
            .binding_error
            .is_some());
        req.allow_partial = true;
        let parsed = parse_table(&dictionary(), &req).unwrap();
        assert_eq!(parsed.preview.missing_parcels, 1);
        assert_eq!(parsed.columns["b"][1], Some(2.));
        assert_eq!(parsed.columns["b"][7], Some(3.));
        req.text = "roi,hemi,b\nArea,right,3\nArea,left,2".into();
        req.key_kind = "label".into();
        assert!(parse_table(&dictionary(), &req)
            .unwrap()
            .preview
            .binding_error
            .is_some());
        req.key_kind = "label_hemi".into();
        req.hemisphere_column = Some("hemi".into());
        assert!(parse_table(&dictionary(), &req)
            .unwrap()
            .preview
            .binding_error
            .is_none());
        req.text = "roi,hemi,b\nArea,right,3\nUnknown,left,2".into();
        assert!(parse_table(&dictionary(), &req)
            .unwrap()
            .preview
            .binding_error
            .is_some()); // partial never excuses unknowns
    }
    #[test]
    fn parcel_table_checks_actual_image_codes_and_supports_quoted_fields() {
        let req = request("id,\"effect, A\"\n1,0\n7,-2\n9,NA\n");
        assert!(create(
            &mut registry(vec![1., 2., 7.]),
            &req,
            "effect, A",
            "bad".into()
        )
        .is_err());
        assert!(create(
            &mut registry(vec![1., 1.5, 7.]),
            &req,
            "effect, A",
            "bad".into()
        )
        .is_err());
        assert!(create(
            &mut registry(vec![1., 7., 9.]),
            &req,
            "effect, A",
            "ok".into()
        )
        .is_ok());
    }
    #[tokio::test]
    async fn parcel_world_sampling_returns_statistic_and_missingness() {
        let mut registry = registry(vec![0., 1., 7., 9.]);
        let info = create(
            &mut registry,
            &request("id,b\n1,0\n7,-2\n9,NA"),
            "b",
            "Stats".into(),
        )
        .unwrap();
        let state = crate::BridgeState::default().unwrap();
        *state.volume_registry.lock().await = registry;
        assert_eq!(
            crate::sample_world_coordinate_impl(&info.volume_id, &[1., 0., 0.], &state)
                .await
                .unwrap(),
            0.
        );
        assert_eq!(
            crate::sample_world_coordinate_impl(&info.volume_id, &[2., 0., 0.], &state)
                .await
                .unwrap(),
            -2.
        );
        assert!(
            crate::sample_world_coordinate_impl(&info.volume_id, &[3., 0., 0.], &state)
                .await
                .unwrap()
                .is_nan()
        );
    }
    #[tokio::test]
    async fn parcel_lookup_render_and_slot_lifecycle() {
        use render_loop::view_state::{LayerConfig, SliceOrientation, ViewId, ViewState};
        use render_loop::{LayerMode, RenderLoopService};
        let mut service = match RenderLoopService::new().await {
            Ok(service) => service,
            Err(e) => {
                eprintln!("SKIP parcel_lookup_render: no WGPU adapter ({e})");
                return;
            }
        };
        service.load_shaders().unwrap();
        service.enable_world_space_rendering().unwrap();
        service.initialize_colormap().unwrap();
        let space = <volmath::NeuroSpace as NeuroSpaceExt>::from_affine_matrix4(
            vec![32, 16, 4],
            nalgebra::Matrix4::identity(),
        )
        .unwrap();
        let data: Vec<f32> = (0..4)
            .flat_map(|_| {
                (0..16).flat_map(|_| {
                    (0..32).map(|x| {
                        if x < 10 {
                            1.
                        } else if x < 21 {
                            7.
                        } else {
                            9.
                        }
                    })
                })
            })
            .collect();
        let geometry = DenseVolume3::from_data(space.clone(), data);
        let underlay = DenseVolume3::from_data(space, vec![0.25; 32 * 16 * 4]);
        service
            .register_volume_with_upload("labels".into(), &geometry, wgpu::TextureFormat::R32Float)
            .unwrap();
        service
            .register_volume_with_upload(
                "underlay".into(),
                &underlay,
                wgpu::TextureFormat::R32Float,
            )
            .unwrap();
        service.create_world_space_bind_groups().unwrap();
        let mut reg = registry(vec![1., 7., 9.]);
        let info = create(
            &mut reg,
            &request("id,beta,t\n9,NA,2\n1,0,-4\n7,-2,8"),
            "beta",
            "Stats".into(),
        )
        .unwrap();
        let overlay = reg.parcel_overlays.get_mut(&info.volume_id).unwrap();
        let lut = overlay.lut("gray", [-2., 2.], None).unwrap();
        let slot = service
            .upsert_custom_colormap("parcel-test".into(), &lut)
            .unwrap();
        let view = ViewState::from_basic_params(
            "labels".into(),
            [16., 8., 2.],
            SliceOrientation::Axial,
            32.,
            [128, 64],
            (0., 1.),
        )
        .with_layers(vec![
            LayerConfig::new("underlay".into())
                .with_colormap(0)
                .with_intensity_window(0., 1.),
            LayerConfig::new("labels".into())
                .with_colormap(slot)
                .with_layer_mode(LayerMode::Label),
        ])
        .with_crosshair(false);
        let first = service
            .request_frame(ViewId::new("parcel-test"), view.clone())
            .await
            .unwrap()
            .image_data;
        let gray_count = |image: &[u8], gray: u8| {
            image
                .chunks_exact(4)
                .filter(|pixel| {
                    pixel[0].abs_diff(gray) <= 1
                        && pixel[1].abs_diff(gray) <= 1
                        && pixel[2].abs_diff(gray) <= 1
                })
                .count()
        };
        assert!(
            gray_count(&first, 128) > 500,
            "A real zero must remain visible at scale midpoint"
        );
        assert!(
            gray_count(&first, 64) > 500,
            "Missing parcels must reveal the underlay"
        );
        assert!(
            gray_count(&first, 0) > 500,
            "Negative values must reach the lower endpoint"
        );
        let hidden = overlay.lut("gray", [-2., 2.], Some([-0.1, 0.1])).unwrap();
        assert_eq!(
            service
                .upsert_custom_colormap("parcel-test".into(), &hidden)
                .unwrap(),
            slot
        );
        let second = service
            .request_frame(ViewId::new("parcel-test"), view.clone())
            .await
            .unwrap()
            .image_data;
        assert_eq!(
            gray_count(&second, 128),
            0,
            "Numeric threshold must hide zero-valued parcels"
        );
        assert!(gray_count(&second, 64) > gray_count(&first, 64) + 500);
        overlay.select("t").unwrap();
        let updated = overlay.lut("gray", [-4., 8.], None).unwrap();
        service
            .upsert_custom_colormap("parcel-test".into(), &updated)
            .unwrap();
        let third = service
            .request_frame(ViewId::new("parcel-test"), view)
            .await
            .unwrap()
            .image_data;
        assert!(
            gray_count(&third, 255) > 500,
            "Column change must reach the rendered image"
        );
        // More iterations than the entire lookup capacity: released rows must be reused.
        service.remove_custom_colormap("parcel-test");
        for i in 0..80 {
            let key = format!("parcel-cycle-{i}");
            assert_eq!(
                service.upsert_custom_colormap(key.clone(), &lut).unwrap(),
                slot
            );
            service.remove_custom_colormap(&key);
        }
    }
}
