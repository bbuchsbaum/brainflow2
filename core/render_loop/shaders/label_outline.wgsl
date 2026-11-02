// --- Label outlines (shared by both masked slice shaders) ---
// The including shader defines LayerData, SliceFeatureUbo, frame,
// LAYER_MODE_LABEL, labelLutTexel and labelAtVoxel(layer, voxel) -> u32.
// Outline settings arrive per layer as `params`, so every label layer draws
// its own outline.
//
// Boundaries are drawn from fractional region membership, not from a binary
// neighbour test, so a 1 mm staircase renders as a straight anti-aliased line:
// - the four voxel centres of the in-plane cell around a point give each label
//   a bilinear membership m in [0, 1]; the region edge is the m = 0.5 isoline.
//   The cell spans the two voxel axes other than the one nearest the slice
//   normal; along that axis each corner takes the voxel where the slice plane
//   crosses its column, so oblique volumes keep near-parallel boundaries;
// - (m - 0.5) / |grad m|, with the analytic gradient mapped to screen pixels,
//   estimates the signed pixel distance to that edge (positive inside);
// - a band wider than one cell also looks at cells on rings of screen-space
//   offsets around the pixel (distance = offset + that cell's distance);
// - coverage is a smoothstep of the distance against the half line width.
// Derivatives are analytic: no fwidth/dpdx under non-uniform control flow.
// Two regions sharing a border have m_a = 1 - m_b there, so both give the same
// distance and the border is one centred line, not one band per region.

fn labelOutlineTexel(layer: LayerData, label_id: u32) -> vec4<f32> {
    // Per-region colour: the label's LUT texel (alpha encodes visibility).
    return labelLutTexel(layer.colormap_id, i32(min(label_id, 0x7fffffffu)));
}

fn labelOutlineColor(layer: LayerData, params: SliceFeatureUbo, label_id: u32) -> vec4<f32> {
    // outline_color_mode: 0 = uniform outline_color, 1 = the region's LUT colour.
    // LUT alpha multiplies the outline alpha so hidden regions stay hidden.
    if (params.outline_color_mode == 1u) {
        let texel = labelOutlineTexel(layer, label_id);
        return vec4<f32>(texel.rgb, params.outline_color.a * texel.a);
    }
    return params.outline_color;
}

fn labelHaloColor(layer: LayerData, params: SliceFeatureUbo, label_id: u32) -> vec4<f32> {
    var alpha = params.halo_color.a;
    if (params.outline_color_mode == 1u) {
        alpha = alpha * labelOutlineTexel(layer, label_id).a;
    }
    return vec4<f32>(params.halo_color.rgb, alpha);
}

// Per-pixel mapping between the slice and the label volume's voxel grid.
struct LabelBasis {
    // Voxel position of the pixel centre.
    p: vec3<f32>,
    // Voxel displacement of one screen pixel along x and y.
    jx: vec3<f32>,
    jy: vec3<f32>,
    // In-plane cell axes and the axis nearest the slice normal.
    ea: vec3<f32>,
    eb: vec3<f32>,
    en: vec3<f32>,
    // Normal-axis change per voxel step along ea / eb within the slice plane.
    dn_da: f32,
    dn_db: f32,
    // Change of the cell fraction per screen pixel along x and along y.
    step_x: vec2<f32>,
    step_y: vec2<f32>,
    // Screen pixels per voxel (the smaller in-plane extent).
    voxel_px: f32,
    valid: bool,
};

fn labelBasisAt(layer: LayerData, world_mm: vec3<f32>) -> LabelBasis {
    var basis: LabelBasis;
    basis.valid = false;
    let voxel_h = layer.world_to_voxel * vec4<f32>(world_mm, 1.0);
    if (voxel_h.w <= 0.0) {
        return basis;
    }
    basis.p = voxel_h.xyz / voxel_h.w;
    basis.jx = (layer.world_to_voxel *
        vec4<f32>(frame.u_mm.xyz / max(f32(frame.target_dim.x), 1.0), 0.0)).xyz;
    basis.jy = (layer.world_to_voxel *
        vec4<f32>(frame.v_mm.xyz / max(f32(frame.target_dim.y), 1.0), 0.0)).xyz;

    let normal = cross(basis.jx, basis.jy);
    let n = abs(normal);
    basis.ea = vec3<f32>(1.0, 0.0, 0.0);
    basis.eb = vec3<f32>(0.0, 1.0, 0.0);
    basis.en = vec3<f32>(0.0, 0.0, 1.0);
    if (n.x >= n.y && n.x >= n.z) {
        basis.ea = vec3<f32>(0.0, 1.0, 0.0);
        basis.eb = vec3<f32>(0.0, 0.0, 1.0);
        basis.en = vec3<f32>(1.0, 0.0, 0.0);
    } else if (n.y >= n.z) {
        basis.ea = vec3<f32>(1.0, 0.0, 0.0);
        basis.eb = vec3<f32>(0.0, 0.0, 1.0);
        basis.en = vec3<f32>(0.0, 1.0, 0.0);
    }
    let n_n = dot(normal, basis.en);
    if (abs(n_n) < 1e-12) {
        return basis;
    }
    // On the plane: normal . (delta) = 0, so dn = -(n_a da + n_b db) / n_n.
    basis.dn_da = -dot(normal, basis.ea) / n_n;
    basis.dn_db = -dot(normal, basis.eb) / n_n;

    basis.step_x = vec2<f32>(dot(basis.jx, basis.ea), dot(basis.jx, basis.eb));
    basis.step_y = vec2<f32>(dot(basis.jy, basis.ea), dot(basis.jy, basis.eb));
    basis.voxel_px = 1.0 / max(max(length(basis.step_x), length(basis.step_y)), 1e-6);
    basis.valid = true;
    return basis;
}

// The in-plane voxel cell around a voxel-space point on the slice.
struct LabelCell {
    // Corner labels at in-plane offsets (0,0), (1,0), (0,1), (1,1).
    labels: vec4<u32>,
    // Fractional position inside the cell.
    f: vec2<f32>,
};

// Label of the cell corner at in-plane voxel index (a, b): the voxel where the
// slice plane crosses that corner's column along the normal axis.
fn labelCellCorner(layer: LayerData, basis: LabelBasis, q: vec3<f32>, a: f32, b: f32) -> u32 {
    let pn = dot(q, basis.en) + (a - dot(q, basis.ea)) * basis.dn_da +
        (b - dot(q, basis.eb)) * basis.dn_db;
    let voxel = a * basis.ea + b * basis.eb + floor(pn + 0.5) * basis.en;
    return labelAtVoxel(layer, vec3<i32>(voxel));
}

fn labelCellAt(layer: LayerData, basis: LabelBasis, q: vec3<f32>) -> LabelCell {
    let qa = dot(q, basis.ea);
    let qb = dot(q, basis.eb);
    let ia = floor(qa);
    let ib = floor(qb);
    var cell: LabelCell;
    cell.f = vec2<f32>(qa - ia, qb - ib);
    cell.labels = vec4<u32>(
        labelCellCorner(layer, basis, q, ia, ib),
        labelCellCorner(layer, basis, q, ia + 1.0, ib),
        labelCellCorner(layer, basis, q, ia, ib + 1.0),
        labelCellCorner(layer, basis, q, ia + 1.0, ib + 1.0),
    );
    return cell;
}

// Signed screen-pixel distance from the cell point to `label`'s m = 0.5
// isoline, positive inside the region.
fn labelEdgeDistancePx(basis: LabelBasis, cell: LabelCell, label: u32) -> f32 {
    let k = select(vec4<f32>(0.0), vec4<f32>(1.0), cell.labels == vec4<u32>(label));
    let fa = cell.f.x;
    let fb = cell.f.y;
    let m = mix(mix(k.x, k.y, fa), mix(k.z, k.w, fa), fb);
    let grad = vec2<f32>(mix(k.y - k.x, k.w - k.z, fb), mix(k.z - k.x, k.w - k.y, fa));
    let g = length(vec2<f32>(dot(grad, basis.step_x), dot(grad, basis.step_y)));
    if (g < 1e-6) {
        return select(-1e6, 1e6, m > 0.5);
    }
    return (m - 0.5) / g;
}

// The edge a cell contributes: distance (signed for a single label, absolute
// for all boundaries) and the label that draws it; `label` is NO_LABEL_EDGE
// when the cell holds no drawable edge.
struct LabelEdge {
    d: f32,
    label: u32,
};

const NO_LABEL_EDGE: u32 = 0xffffffffu;

fn labelCellEdge(
    layer: LayerData,
    params: SliceFeatureUbo,
    basis: LabelBasis,
    cell: LabelCell,
) -> LabelEdge {
    var edge: LabelEdge;
    edge.d = 1e6;
    edge.label = NO_LABEL_EDGE;
    let labels = cell.labels;
    if (all(labels == vec4<u32>(labels.x))) {
        return edge;
    }

    // outline_mode: 0 = single selected label, 1 = all parcel boundaries.
    if (params.outline_mode == 1u) {
        // The nearest edge of a drawn region: background and hidden regions
        // (zero outline alpha) never claim a border, so a hidden region's
        // visible neighbour still outlines it. On a shared border both regions
        // are equidistant and the lower id colours the single line.
        for (var i = 0u; i < 4u; i = i + 1u) {
            let label = labels[i];
            if (label == 0u || labelOutlineColor(layer, params, label).a <= 0.0) {
                continue;
            }
            let d = abs(labelEdgeDistancePx(basis, cell, label));
            if (d < edge.d - 1e-4 || (abs(d - edge.d) <= 1e-4 && label < edge.label)) {
                edge.d = d;
                edge.label = label;
            }
        }
        return edge;
    }

    let selected = params.selected_label_id;
    if (selected != 0u && any(labels == vec4<u32>(selected))) {
        edge.d = labelEdgeDistancePx(basis, cell, selected);
        edge.label = selected;
    }
    return edge;
}

// Anti-aliased coverage of a band of half-width `half_px` at distance `d_px`.
fn labelBandCoverage(d_px: f32, half_px: f32) -> f32 {
    return 1.0 - smoothstep(half_px - 0.5, half_px + 0.5, d_px);
}

// Outline over halo, each weighted by its coverage (straight alpha).
fn labelOutlineComposite(
    layer: LayerData,
    params: SliceFeatureUbo,
    label: u32,
    line_coverage: f32,
    halo_coverage: f32,
    fade: f32,
) -> vec4<f32> {
    var line = labelOutlineColor(layer, params, label);
    line.a = line.a * line_coverage * fade;
    var halo = labelHaloColor(layer, params, label);
    halo.a = halo.a * max(halo_coverage - line_coverage, 0.0) * fade;
    let alpha = line.a + halo.a * (1.0 - line.a);
    if (alpha <= 0.0) {
        return vec4<f32>(0.0);
    }
    let rgb = (line.rgb * line.a + halo.rgb * halo.a * (1.0 - line.a)) / alpha;
    return vec4<f32>(rgb, alpha);
}

const LABEL_MAX_RINGS: u32 = 4u;

fn sampleLabelOutline(layer: LayerData, params: SliceFeatureUbo, world_mm: vec3<f32>) -> vec4<f32> {
    if (params.outline_enabled == 0u || layer.layer_mode != LAYER_MODE_LABEL) {
        return vec4<f32>(0.0);
    }
    let basis = labelBasisAt(layer, world_mm);
    if (!basis.valid) {
        return vec4<f32>(0.0);
    }

    // Line plus halo render as requested up to about two voxels on screen, so
    // zooming out never smears a thick band over small regions; the line is
    // never thinner than one pixel. Below one pixel per voxel the line fades
    // so dense parcellations do not flood.
    let band_px = max(2.0 * basis.voxel_px, 1.0);
    let width_px = clamp(params.outline_thickness_px, 1.0, band_px);
    let halo_px = clamp(params.halo_thickness_px, 0.0, max(band_px - width_px, 0.0) * 0.5);
    let half_px = width_px * 0.5;
    let reach_px = half_px + halo_px + 0.5;
    let fade = clamp(basis.voxel_px, 0.35, 1.0);

    let own = labelCellEdge(layer, params, basis, labelCellAt(layer, basis, basis.p));
    var label = own.label;
    var dist = abs(own.d);

    // An edge inside the pixel's own cell lies within about 0.35 voxel of it
    // (a 45 degree edge; 0.5 for an axis-aligned one). Wider bands search
    // rings of offset cells; a candidate's distance is its offset plus that
    // cell's distance, which overestimates by at most 8% between directions.
    let cell_reach_px = 0.35 * basis.voxel_px;
    if (reach_px > cell_reach_px) {
        let ring_step = max(cell_reach_px, 0.5);
        let rings = min(u32(ceil((reach_px - cell_reach_px) / ring_step)), LABEL_MAX_RINGS);
        for (var ring = 1u; ring <= rings; ring = ring + 1u) {
            let r = f32(ring) * ring_step;
            if (dist <= r) {
                break;
            }
            for (var j = 0u; j < 8u; j = j + 1u) {
                // Eight screen-space directions, 45 degrees apart.
                let angle = f32(j) * 0.78539816;
                let o = vec2<f32>(cos(angle), sin(angle)) * r;
                let q = basis.p + o.x * basis.jx + o.y * basis.jy;
                let edge = labelCellEdge(layer, params, basis, labelCellAt(layer, basis, q));
                if (edge.label == NO_LABEL_EDGE) {
                    continue;
                }
                let d = abs(edge.d) + r;
                if (d < dist - 1e-4 || (abs(d - dist) <= 1e-4 && edge.label < label)) {
                    dist = d;
                    label = edge.label;
                }
            }
        }
    }
    if (label == NO_LABEL_EDGE || dist >= reach_px) {
        return vec4<f32>(0.0);
    }

    let line = labelBandCoverage(dist, half_px);
    var halo = select(0.0, labelBandCoverage(dist, half_px + halo_px), halo_px > 0.0);
    if (params.outline_mode != 1u) {
        // Single label: the halo is a band just outside the selected region.
        var inside = labelAtVoxel(layer, vec3<i32>(floor(basis.p + 0.5))) == label;
        if (own.label != NO_LABEL_EDGE) {
            inside = own.d > 0.0;
        }
        if (inside) {
            halo = 0.0;
        }
    }
    return labelOutlineComposite(layer, params, label, line, halo, fade);
}
