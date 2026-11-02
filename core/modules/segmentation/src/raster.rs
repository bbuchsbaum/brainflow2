use crate::{invalid, Result};
use nalgebra::{Matrix4, Vector3, Vector4};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(rename = "SegmentationTool")]
pub enum Tool {
    Brush,
    Eraser,
    Contour,
}
pub struct RasterRequest<'a> {
    pub dimensions: [u32; 3],
    pub affine: Matrix4<f32>,
    pub normal_axis: u8,
    pub slice_index: u32,
    pub tool: Tool,
    pub radius_mm: f32,
    pub points_world: &'a [[f32; 3]],
}
fn segment_distance_squared(p: Vector3<f64>, a: Vector3<f64>, b: Vector3<f64>) -> f64 {
    let edge = b - a;
    let length = edge.norm_squared();
    let t = if length > 0.0 {
        ((p - a).dot(&edge) / length).clamp(0.0, 1.0)
    } else {
        0.0
    };
    (p - (a + edge * t)).norm_squared()
}
/// Capsule union for brush/eraser, or closed polygon for contour. Membership is
/// defined at voxel centres in physical millimetres, independently of view zoom.
pub fn rasterize(request: &RasterRequest<'_>) -> Result<Vec<[u32; 3]>> {
    let r = request;
    let axis = usize::from(r.normal_axis);
    if axis >= 3
        || r.dimensions.contains(&0)
        || r.slice_index >= r.dimensions[axis]
        || r.points_world.is_empty()
        || r.points_world.len() > 16384
        || !r.radius_mm.is_finite()
        || r.radius_mm <= 0.0
        || r.radius_mm > 100.0
        || r.points_world.iter().flatten().any(|v| !v.is_finite())
    {
        return Err(invalid("Invalid native stroke, radius or slice"));
    }
    if r.tool == Tool::Contour && r.points_world.len() < 3 {
        return Err(invalid("A contour needs at least three points"));
    }
    let affine = r.affine.cast::<f64>();
    let inverse = affine
        .try_inverse()
        .ok_or_else(|| invalid("Reference affine is singular"))?;
    if !affine.iter().all(|v| v.is_finite())
        || affine
            .row(3)
            .iter()
            .zip([0.0, 0.0, 0.0, 1.0])
            .any(|(a, b)| (*a - b).abs() > 1e-6)
    {
        return Err(invalid("Reference affine is non-finite"));
    }
    let points: Vec<Vector3<f64>> = r
        .points_world
        .iter()
        .map(|&p| Vector3::from(p).cast())
        .collect();
    let axes: Vec<usize> = (0..3).filter(|&a| a != axis).collect();
    let mut low = [f64::INFINITY; 2];
    let mut high = [f64::NEG_INFINITY; 2];
    let mut voxel_points = Vec::new();
    for p in &points {
        let voxel = inverse * Vector4::new(p.x, p.y, p.z, 1.0);
        if (voxel[axis] - f64::from(r.slice_index)).abs() > 1e-3 {
            return Err(invalid(
                "Stroke points are not on the selected native slice",
            ));
        }
        voxel_points.push([voxel[axes[0]], voxel[axes[1]]]);
        for i in 0..2 {
            low[i] = low[i].min(voxel[axes[i]]);
            high[i] = high[i].max(voxel[axes[i]]);
        }
    }
    // Inputs arrive as f32 world coordinates. Use one documented numerical
    // boundary tolerance in both candidate bounds and footprint membership.
    let tolerance_mm = points
        .iter()
        .flat_map(|p| p.iter())
        .fold(1.0f64, |a, &v| a.max(v.abs()))
        * f64::from(f32::EPSILON)
        * 2.0;
    if r.tool == Tool::Contour {
        let area = (1..points.len() - 1)
            .map(|i| {
                (points[i] - points[0])
                    .cross(&(points[i + 1] - points[0]))
                    .norm()
            })
            .sum::<f64>();
        if area <= tolerance_mm.powi(2) {
            return Err(invalid("The contour has no area"));
        }
    }
    let mut start = [0u32; 2];
    let mut end = [0u32; 2];
    for i in 0..2 {
        let margin = if r.tool == Tool::Contour {
            tolerance_mm * inverse.fixed_view::<1, 3>(axes[i], 0).norm()
        } else {
            (f64::from(r.radius_mm) + tolerance_mm) * inverse.fixed_view::<1, 3>(axes[i], 0).norm()
        };
        let lo = (low[i] - margin).ceil().max(0.0);
        let hi = (high[i] + margin)
            .floor()
            .min(f64::from(r.dimensions[axes[i]]) - 1.0);
        if lo > hi {
            return Ok(Vec::new());
        }
        start[i] = lo as u32;
        end[i] = hi as u32;
    }
    let candidates = u64::from(end[0] - start[0] + 1) * u64::from(end[1] - start[1] + 1);
    if candidates > 2_000_000 || candidates.saturating_mul(points.len() as u64) > 20_000_000 {
        return Err(invalid(
            "Stroke is too complex; finish shorter strokes or reduce the brush",
        ));
    }
    let mut output = Vec::new();
    for y in start[1]..=end[1] {
        for x in start[0]..=end[0] {
            let mut voxel = [0; 3];
            voxel[axis] = r.slice_index;
            voxel[axes[0]] = x;
            voxel[axes[1]] = y;
            let p = (affine
                * Vector4::new(
                    f64::from(voxel[0]),
                    f64::from(voxel[1]),
                    f64::from(voxel[2]),
                    1.0,
                ))
            .xyz();
            let inside = if r.tool == Tool::Contour {
                let q = [f64::from(x), f64::from(y)];
                let mut inside = false;
                let mut boundary = false;
                for i in 0..voxel_points.len() {
                    let a = voxel_points[i];
                    let b = voxel_points[(i + 1) % voxel_points.len()];
                    boundary |=
                        segment_distance_squared(p, points[i], points[(i + 1) % points.len()])
                            <= tolerance_mm.powi(2);
                    if (a[1] > q[1]) != (b[1] > q[1])
                        && q[0] < (b[0] - a[0]) * (q[1] - a[1]) / (b[1] - a[1]) + a[0]
                    {
                        inside = !inside;
                    }
                }
                inside || boundary
            } else if points.len() == 1 {
                (p - points[0]).norm_squared() <= (f64::from(r.radius_mm) + tolerance_mm).powi(2)
            } else {
                points.windows(2).any(|pair| {
                    segment_distance_squared(p, pair[0], pair[1])
                        <= (f64::from(r.radius_mm) + tolerance_mm).powi(2)
                })
            };
            if inside {
                output.push(voxel);
            }
        }
    }
    Ok(output)
}
