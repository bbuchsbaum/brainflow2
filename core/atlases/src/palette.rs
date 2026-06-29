/*!
 * Atlas ROI palette computation.
 *
 * Resolves discrete per-label colors for a loaded atlas and packs them into a
 * bridge-friendly response (`AtlasPaletteResponse`) whose JSON shape matches the
 * hand-written TypeScript contract in `ui2/src/types/atlasPalette.ts`.
 *
 * Color source, in order:
 *   1. The atlas's own native label colors (Glasser / ASEG / Olsen-MTL) when the
 *      caller did not force a specific palette `kind`.
 *   2. Otherwise the purpose-built `neuroatlas::colors` ROI-palette engine
 *      (Schaefer has no native RGB -> `NetworkHarmony`; others -> `MaximinView`),
 *      which is slice-conflict aware and network-anchored.
 */

use neuroatlas::atlas::Atlas;
use neuroatlas::colors::{
    roi_palette, NetworkHarmonyConfig, PaletteConfig, PaletteKind, RoiColor, RoiColorRecord,
};
use neuroatlas::core::types::Hemisphere;
use serde::{Deserialize, Serialize};

use crate::types::AtlasError;

/// Palette recipe exposed to the bridge. Serializes to the snake_case strings the
/// frontend `AtlasPaletteKind` union expects (`network_harmony`, `maximin_view`, ...).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AtlasPaletteKind {
    MaximinView,
    NetworkHarmony,
    RuleHcl,
    Embedding,
}

impl From<PaletteKind> for AtlasPaletteKind {
    fn from(kind: PaletteKind) -> Self {
        match kind {
            PaletteKind::MaximinView => AtlasPaletteKind::MaximinView,
            PaletteKind::NetworkHarmony => AtlasPaletteKind::NetworkHarmony,
            PaletteKind::RuleHcl => AtlasPaletteKind::RuleHcl,
            PaletteKind::Embedding => AtlasPaletteKind::Embedding,
        }
    }
}

impl From<AtlasPaletteKind> for PaletteKind {
    fn from(kind: AtlasPaletteKind) -> Self {
        match kind {
            AtlasPaletteKind::MaximinView => PaletteKind::MaximinView,
            AtlasPaletteKind::NetworkHarmony => PaletteKind::NetworkHarmony,
            AtlasPaletteKind::RuleHcl => PaletteKind::RuleHcl,
            AtlasPaletteKind::Embedding => PaletteKind::Embedding,
        }
    }
}

/// Packed label LUT. `lut_rgb` is `(max_label + 1) * 3` bytes indexed by label id
/// (texel k = color of label k); label 0 is background.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AtlasPaletteLut {
    pub max_label: u32,
    pub lut_rgb: Vec<u8>,
    pub background: [u8; 3],
    pub kind: AtlasPaletteKind,
    pub seed: u64,
}

/// One legend row: id, name, resolved color, and optional grouping metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AtlasPaletteLegendEntry {
    pub label_id: u32,
    pub roi: String,
    pub color: [u8; 3],
    pub network: Option<String>,
    pub hemisphere: Option<String>,
}

/// Full palette response: LUT for the GPU + legend for the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AtlasPaletteResponse {
    pub lut: AtlasPaletteLut,
    pub legend: Vec<AtlasPaletteLegendEntry>,
}

const BACKGROUND: [u8; 3] = [0, 0, 0];

fn hemisphere_str(h: Hemisphere) -> String {
    format!("{:?}", h).to_lowercase()
}

/// Compute the discrete palette + legend for a loaded atlas.
///
/// `kind == None` prefers native label colors when the atlas defines them,
/// otherwise falls back to the engine's default recipe for the atlas. An explicit
/// `kind` always routes through the engine.
pub fn compute_palette<A: Atlas>(
    atlas: &A,
    atlas_id: &str,
    kind: Option<AtlasPaletteKind>,
    seed: Option<u64>,
) -> Result<AtlasPaletteResponse, AtlasError> {
    let labels = atlas.labels();
    if labels.is_empty() {
        return Err(AtlasError::LoadFailed(format!(
            "Atlas '{}' exposes no labels; cannot build a categorical palette",
            atlas_id
        )));
    }

    let max_label = labels.iter().map(|l| l.id).max().unwrap_or(0);

    // label_id -> (network name, hemisphere) for legend enrichment. Always
    // available from labels even when colors are not; falls back to parsing the
    // Schaefer-style label name when the atlas attaches no metadata.
    let mut network_of = std::collections::HashMap::new();
    let mut hemi_of = std::collections::HashMap::new();
    for l in labels {
        let network = l
            .network
            .as_ref()
            .map(|n| n.name.clone())
            .or_else(|| network_from_label_name(&l.name));
        if let Some(net) = network {
            network_of.insert(l.id, net);
        }
        let hemi = l
            .hemisphere
            .map(hemisphere_str)
            .or_else(|| hemisphere_from_label_name(&l.name));
        if let Some(h) = hemi {
            hemi_of.insert(l.id, h);
        }
    }

    let has_native = labels.iter().all(|l| l.color.is_some());

    // Resolve the (label_id, roi, color) assignments and the reported kind.
    let (colors, resolved_kind, used_seed): (Vec<RoiColor>, AtlasPaletteKind, u64) =
        if kind.is_none() && has_native {
            // Native per-region colors directly off the atlas labels.
            let colors = labels
                .iter()
                .map(|l| RoiColor {
                    roi: l.name.clone(),
                    label_id: l.id,
                    color: l.color.unwrap_or(BACKGROUND),
                })
                .collect();
            // Report the recipe that *would* apply, for the frontend palette key.
            (colors, neuroatlas_default_kind(atlas_id), 0)
        } else {
            // Generated palette via the slice-aware engine. Default (no explicit
            // kind) is MaximinView for maximally-distinct, slice-aware per-parcel
            // colors; NetworkHarmony etc. are available via the palette picker.
            let records = roi_records_single_pass(atlas);
            let requested_kind: PaletteKind = match kind {
                Some(k) => k.into(),
                None => PaletteKind::MaximinView,
            };
            let used_seed = seed.unwrap_or(0);
            let (colors, resolved_kind) = run_engine_palette(requested_kind, &records, used_seed)?;
            (colors, resolved_kind.into(), used_seed)
        };

    // Pack the LUT: texel k = color of label k, background elsewhere.
    let size = (max_label as usize).saturating_add(1);
    let mut lut: Vec<[u8; 3]> = vec![BACKGROUND; size];
    for c in &colors {
        if (c.label_id as usize) < size {
            lut[c.label_id as usize] = c.color;
        }
    }
    let mut lut_rgb = Vec::with_capacity(size * 3);
    for px in &lut {
        lut_rgb.extend_from_slice(px);
    }

    // Legend rows, enriched with network/hemisphere from the label table.
    let legend = colors
        .iter()
        .map(|c| AtlasPaletteLegendEntry {
            label_id: c.label_id,
            roi: clean_roi_name(&c.roi),
            color: c.color,
            network: network_of.get(&c.label_id).cloned(),
            hemisphere: hemi_of.get(&c.label_id).cloned(),
        })
        .collect();

    Ok(AtlasPaletteResponse {
        lut: AtlasPaletteLut {
            max_label,
            lut_rgb,
            background: BACKGROUND,
            kind: resolved_kind,
            seed: used_seed,
        },
        legend,
    })
}

fn neuroatlas_default_kind(atlas_id: &str) -> AtlasPaletteKind {
    neuroatlas::colors::default_palette_for_atlas(atlas_id).into()
}

/// Build the engine `PaletteConfig` for a requested palette kind.
///
/// The stock `NetworkHarmonyConfig` asks for `candidate_multiplier (8.0) * parcels`
/// distinct, WCAG-contrast-passing candidate colors inside each network's narrow
/// hue wedge. For dense atlases (Schaefer 17/400) the most populous Yeo networks
/// (e.g. ContA) cannot be satisfied at the defaults, so the engine hard-errors with
/// "Not enough candidate colours for network ...". We relax the per-network pool to
/// a recipe empirically verified feasible for Schaefer 7/17 — a smaller multiplier,
/// a lower contrast floor, and a slightly tighter hue band (which actually *improves*
/// network hue-separation versus the 28 degree default).
fn engine_palette_config(kind: PaletteKind, seed: u64) -> PaletteConfig {
    let mut cfg = PaletteConfig {
        seed: Some(seed),
        ..PaletteConfig::default()
    };
    if kind == PaletteKind::NetworkHarmony {
        let nh = NetworkHarmonyConfig {
            candidate_multiplier: 2.0,
            min_contrast: 1.4,
            hue_width: 24.0,
            seed,
            ..NetworkHarmonyConfig::default()
        };
        cfg.network_harmony = Some(nh);
    }
    cfg
}

/// Run the palette engine for `kind`, gracefully degrading NetworkHarmony to
/// MaximinView when the per-network candidate pools still can't be satisfied for
/// this atlas. Returns the colors and the palette kind actually used so the bridge
/// reports an honest `kind` to the frontend.
fn run_engine_palette(
    kind: PaletteKind,
    records: &[RoiColorRecord],
    seed: u64,
) -> Result<(Vec<RoiColor>, PaletteKind), AtlasError> {
    let cfg = engine_palette_config(kind, seed);
    match roi_palette(kind, records, cfg) {
        Ok(colors) => Ok((colors, kind)),
        Err(e) if kind == PaletteKind::NetworkHarmony => {
            tracing::warn!(
                error = %e,
                "NetworkHarmony palette infeasible for this atlas; falling back to MaximinView"
            );
            let cfg = engine_palette_config(PaletteKind::MaximinView, seed);
            let colors = roi_palette(PaletteKind::MaximinView, records, cfg)
                .map_err(|e| AtlasError::LoadFailed(format!("roi_palette failed: {}", e)))?;
            Ok((colors, PaletteKind::MaximinView))
        }
        Err(e) => Err(AtlasError::LoadFailed(format!("roi_palette failed: {}", e))),
    }
}

/// Build ROI palette records with a single pass over the label volume.
///
/// `neuroatlas::colors::records_for_atlas` computes each ROI centroid with its own
/// full-volume scan — O(n_rois * n_voxels), which is ~138s for 400 ROIs at 1mm in a
/// debug build. Because the voxel->world affine is linear, an ROI's center of mass
/// equals `affine * mean(voxel_coords)`, so one accumulation pass yields the exact
/// same centroids in O(n_voxels). Network/hemisphere metadata is copied from labels.
fn roi_records_single_pass<A: Atlas>(atlas: &A) -> Vec<RoiColorRecord> {
    let labels = atlas.labels();

    let max_id = labels.iter().map(|l| l.id).max().unwrap_or(0) as usize;
    // Indexed by label id (small, dense domain) to avoid per-voxel hashing.
    let centers: Vec<Option<[f64; 3]>> = match atlas.volume() {
        Some(vol) => {
            let mut sums: Vec<([f64; 3], u64)> = vec![([0.0; 3], 0); max_id + 1];
            for ((x, y, z), &id) in vol.data.indexed_iter() {
                let id = id as usize;
                if id == 0 || id > max_id {
                    continue;
                }
                let e = &mut sums[id];
                e.0[0] += x as f64;
                e.0[1] += y as f64;
                e.0[2] += z as f64;
                e.1 += 1;
            }
            let a = &vol.affine;
            sums.into_iter()
                .map(|(s, c)| {
                    if c == 0 {
                        return None;
                    }
                    let n = c as f64;
                    let (vx, vy, vz) = (s[0] / n, s[1] / n, s[2] / n);
                    Some([
                        a[(0, 0)] * vx + a[(0, 1)] * vy + a[(0, 2)] * vz + a[(0, 3)],
                        a[(1, 0)] * vx + a[(1, 1)] * vy + a[(1, 2)] * vz + a[(1, 3)],
                        a[(2, 0)] * vx + a[(2, 1)] * vy + a[(2, 2)] * vz + a[(2, 3)],
                    ])
                })
                .collect()
        }
        // No volume (e.g. surface atlas): fall back to zero centroids; the engine
        // still produces a valid palette, just without spatial conflict separation.
        None => Vec::new(),
    };

    labels
        .iter()
        .map(|label| {
            let center = centers
                .get(label.id as usize)
                .copied()
                .flatten()
                .unwrap_or([0.0, 0.0, 0.0]);
            let mut record = RoiColorRecord::new(label.id, label.name.clone(), center);
            if let Some(hemi) = label.hemisphere {
                record = record.with_hemisphere(hemi);
            }
            // Honor the atlas's network metadata; fall back to parsing the Schaefer
            // label name so NetworkHarmony can actually group by Yeo network.
            let network = label
                .network
                .as_ref()
                .map(|n| n.name.clone())
                .or_else(|| network_from_label_name(&label.name));
            if let Some(net) = network {
                record = record.with_network(net);
            }
            record
        })
        .collect()
}

/// Parse the Yeo network name from a Schaefer-style label name when the atlas
/// attached no network metadata. e.g. "17Networks_LH_VisCent_ExStr_1" -> "VisCent",
/// "7Networks_RH_Default_PCC_1" -> "Default". Returns None for names that don't
/// match the "{N}Networks_{LH|RH}_{Network}_..." convention.
fn network_from_label_name(name: &str) -> Option<String> {
    let parts: Vec<&str> = name.split('_').collect();
    if parts.len() >= 3 && parts[0].ends_with("Networks") && (parts[1] == "LH" || parts[1] == "RH")
    {
        Some(parts[2].to_string())
    } else {
        None
    }
}

/// Parse the hemisphere from a Schaefer-style "{N}Networks_{LH|RH}_..." label
/// name when the atlas attaches no hemisphere metadata. Returns the lowercase
/// string form used elsewhere in the legend ("left" / "right").
fn hemisphere_from_label_name(name: &str) -> Option<String> {
    let parts: Vec<&str> = name.split('_').collect();
    match parts.get(1).copied() {
        Some("LH") => Some("left".to_string()),
        Some("RH") => Some("right".to_string()),
        _ => None,
    }
}

/// Strip the YEO prefix from a Schaefer-style label core, e.g.
/// "17Networks_LH_VisCent_ExStr_1" -> "VisCent_ExStr_1". Leaves non-matching
/// names untouched.
fn strip_yeo_prefix(core: &str) -> String {
    let parts: Vec<&str> = core.split('_').collect();
    if parts.len() > 2 && parts[0].ends_with("Networks") && (parts[1] == "LH" || parts[1] == "RH") {
        parts[2..].join("_")
    } else {
        core.to_string()
    }
}

/// Produce a compact, human-readable region name for legends and hover.
///
/// Some atlas builds bake the raw color-table line into the label name, e.g.
/// "17Networks_LH_VisCent_ExStr_1 120 18 131 0". Drop trailing whitespace-
/// separated numeric tokens (the R G B A suffix) and the "{N}Networks_{LH|RH}_"
/// prefix, yielding "VisCent_ExStr_1". Already-clean names pass through unchanged.
fn clean_roi_name(name: &str) -> String {
    let tokens: Vec<&str> = name.split_whitespace().collect();
    // Only strip a trailing run of >= 3 integer tokens (an "R G B [A]" color-table
    // suffix some atlas builds bake into the name). Never strip a lone trailing
    // number, which is often part of a real label (e.g. "Area 7"), and never strip
    // the whole name. Atlases that don't carry this artifact pass through unchanged.
    let trailing_ints = tokens
        .iter()
        .rev()
        .take_while(|t| !t.is_empty() && t.chars().all(|c| c.is_ascii_digit()))
        .count();
    let core = if trailing_ints >= 3 && trailing_ints < tokens.len() {
        tokens[..tokens.len() - trailing_ints].join(" ")
    } else {
        tokens.join(" ")
    };
    strip_yeo_prefix(&core)
}

#[cfg(test)]
mod tests {
    use super::*;
    use neuroatlas::atlas::{AtlasBuilder, SchaeferBuilder};
    use neuroatlas::core::types::Resolution;
    use std::time::Instant;

    #[test]
    fn clean_roi_name_strips_schaefer_color_suffix_and_yeo_prefix() {
        // Full raw Schaefer label name: Yeo prefix + baked "R G B A" color suffix.
        assert_eq!(
            clean_roi_name("17Networks_LH_VisCent_ExStr_1 120 18 131 0"),
            "VisCent_ExStr_1"
        );
        assert_eq!(
            clean_roi_name("7Networks_RH_Default_PCC_1 0 118 14 0"),
            "Default_PCC_1"
        );
    }

    #[test]
    fn clean_roi_name_preserves_non_schaefer_names() {
        // A lone trailing number is part of a real name, not a color suffix.
        assert_eq!(clean_roi_name("Area 7"), "Area 7");
        // Two trailing numbers are still below the >=3 color-suffix threshold.
        assert_eq!(clean_roi_name("Area 7 b 12"), "Area 7 b 12");
        // No trailing numbers, no Yeo prefix: untouched (Glasser-style).
        assert_eq!(clean_roi_name("L_V1_ROI"), "L_V1_ROI");
        // Native names without the artifact pass straight through.
        assert_eq!(clean_roi_name("Hippocampus"), "Hippocampus");
    }

    #[test]
    fn clean_roi_name_never_empties_an_all_numeric_name() {
        // Guard: stripping must leave a non-empty core, so an all-numeric token run
        // is preserved rather than collapsed to "".
        assert_eq!(clean_roi_name("1 2 3"), "1 2 3");
    }

    #[test]
    fn strip_yeo_prefix_only_matches_the_yeo_pattern() {
        assert_eq!(
            strip_yeo_prefix("17Networks_LH_VisCent_ExStr_1"),
            "VisCent_ExStr_1"
        );
        assert_eq!(
            strip_yeo_prefix("7Networks_RH_Default_PCC_1"),
            "Default_PCC_1"
        );
        // Non-Yeo names are returned verbatim.
        assert_eq!(strip_yeo_prefix("L_V1_ROI"), "L_V1_ROI");
        assert_eq!(strip_yeo_prefix("Hippocampus"), "Hippocampus");
    }

    #[test]
    fn network_and_hemisphere_parse_only_for_schaefer_names() {
        assert_eq!(
            network_from_label_name("17Networks_LH_VisCent_ExStr_1"),
            Some("VisCent".to_string())
        );
        assert_eq!(network_from_label_name("L_V1_ROI"), None);
        assert_eq!(network_from_label_name("Hippocampus"), None);

        assert_eq!(
            hemisphere_from_label_name("17Networks_LH_VisCent_ExStr_1"),
            Some("left".to_string())
        );
        assert_eq!(
            hemisphere_from_label_name("7Networks_RH_Default_PCC_1"),
            Some("right".to_string())
        );
        assert_eq!(hemisphere_from_label_name("L_V1_ROI"), None);
    }

    // Backend smoke test: build the discrete palette for a cached Schaefer atlas and
    // report timing + color coverage. Ignored by default (needs the cached NIfTI).
    // Run: cargo test -p atlases --lib palette::tests::schaefer_palette_smoke -- --ignored --nocapture
    #[test]
    #[ignore = "requires cached Schaefer 400/17 1mm NIfTI"]
    fn schaefer_palette_smoke() {
        let mut atlas = SchaeferBuilder::new()
            .parcels(400)
            .networks(17)
            .resolution(Resolution::MM1)
            .build()
            .expect("build schaefer");

        let t = Instant::now();
        futures::executor::block_on(atlas.load()).expect("load schaefer");
        eprintln!("[smoke] atlas.load(): {:?}", t.elapsed());

        let t = Instant::now();
        let resp = compute_palette(&atlas, "schaefer2018", None, None).expect("compute_palette");
        eprintln!(
            "[smoke] compute_palette(): {:?}  max_label={} legend={} kind={:?}",
            t.elapsed(),
            resp.lut.max_label,
            resp.legend.len(),
            resp.lut.kind
        );

        assert_eq!(
            resp.lut.lut_rgb.len(),
            (resp.lut.max_label as usize + 1) * 3,
            "lut_rgb length must be (max_label+1)*3"
        );
        let nonbg = resp
            .lut
            .lut_rgb
            .chunks(3)
            .filter(|c| *c != [0u8, 0, 0])
            .count();
        eprintln!("[smoke] non-background LUT entries: {}", nonbg);
        assert!(resp.lut.max_label >= 400, "expected >=400 labels");
        assert!(nonbg > 100, "expected many distinct colored labels");

        // Networks must be parsed from Schaefer label names (the atlas itself does
        // not attach them) so NetworkHarmony can group by Yeo network.
        let with_network = resp.legend.iter().filter(|e| e.network.is_some()).count();
        eprintln!(
            "[smoke] legend entries with a network: {} / {}",
            with_network,
            resp.legend.len()
        );
        assert!(
            with_network > 300,
            "expected most parcels to carry a parsed network name"
        );

        // Legend names must be cleaned for display: no baked-in color-table digits
        // and no "{N}Networks_{LH|RH}_" prefix. Hemisphere is parsed from the name.
        let sample = &resp.legend[0];
        eprintln!(
            "[smoke] sample legend: roi={:?} network={:?} hemisphere={:?}",
            sample.roi, sample.network, sample.hemisphere
        );
        assert!(
            !sample.roi.contains("Networks_"),
            "legend roi should have the Yeo prefix stripped, got {:?}",
            sample.roi
        );
        assert!(
            !sample.roi.chars().any(|c| c == ' '),
            "legend roi should not carry the trailing color-table suffix, got {:?}",
            sample.roi
        );
        let with_hemi = resp
            .legend
            .iter()
            .filter(|e| e.hemisphere.is_some())
            .count();
        assert!(
            with_hemi > 300,
            "expected most parcels to carry a parsed hemisphere, got {with_hemi}"
        );

        // The records fed to the engine must also carry networks (separate path
        // from the legend), or NetworkHarmony silently degrades to MaximinView.
        let records = roi_records_single_pass(&atlas);
        let rec_with_net = records.iter().filter(|r| r.network.is_some()).count();
        assert!(
            rec_with_net > 300,
            "expected records to carry parsed networks, got {rec_with_net}"
        );

        // NetworkHarmony must succeed (our tuned config makes the populous Yeo
        // networks feasible) and produce a *different* palette than MaximinView.
        let maximin = compute_palette(
            &atlas,
            "schaefer2018",
            Some(AtlasPaletteKind::MaximinView),
            None,
        )
        .expect("maximin");
        let harmony = compute_palette(
            &atlas,
            "schaefer2018",
            Some(AtlasPaletteKind::NetworkHarmony),
            None,
        )
        .expect("harmony");
        assert_eq!(
            harmony.lut.kind,
            AtlasPaletteKind::NetworkHarmony,
            "NetworkHarmony must not have fallen back to MaximinView"
        );
        assert_ne!(
            maximin.lut.lut_rgb, harmony.lut.lut_rgb,
            "NetworkHarmony should differ from MaximinView once networks are present"
        );
    }
}
