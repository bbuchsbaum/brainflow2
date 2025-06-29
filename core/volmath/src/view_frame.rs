/// ViewFrame creation and manipulation for slice rendering
use nalgebra::{Vector2, Vector3, Matrix3};

/// 2D viewport dimensions in pixels
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Viewport {
    pub width: u32,
    pub height: u32,
}

/// Core view frame representation
/// Defines the mapping from normalized device coordinates to world space
#[derive(Debug, Clone, PartialEq)]
pub struct ViewFrame {
    /// World position at NDC (0,0) in mm
    pub origin: Vector3<f32>,
    
    /// World vector covered by NDC [0,1] in X direction
    pub u: Vector3<f32>,
    
    /// World vector covered by NDC [0,1] in Y direction  
    pub v: Vector3<f32>,
    
    /// Viewport dimensions in pixels
    pub viewport: Viewport,
}

/// Viewing plane specification
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Plane {
    /// XY plane, Z normal
    Axial,
    /// XZ plane, Y normal
    Coronal,
    /// YZ plane, X normal
    Sagittal,
    /// Custom oblique plane
    Custom {
        normal: Vector3<f32>,
        up: Vector3<f32>,
    }
}

/// Volume metadata required for slice calculations
#[derive(Debug, Clone, PartialEq)]
pub struct VolumeMeta {
    /// Dimensions in voxels
    pub dims: Vector3<u32>,
    
    /// Spacing in mm/voxel
    pub spacing: Vector3<f32>,
    
    /// World position of voxel (0,0,0) in mm
    pub origin: Vector3<f32>,
    
    /// 3x3 orientation matrix (voxel to world rotation)
    pub direction: Option<Matrix3<f32>>,
}

/// Render layer specification for multi-volume rendering
#[derive(Debug, Clone)]
pub struct RenderLayer {
    /// Unique identifier for the volume
    pub volume_id: String,
    
    /// Colormap ID
    pub colormap_id: u32,
    
    /// Layer opacity [0,1]
    pub opacity: f32,
    
    /// Intensity windowing  
    pub window_level: f32,
    pub window_width: f32,
    
    /// Optional thresholding
    pub threshold_low: Option<f32>,
    pub threshold_high: Option<f32>,
    pub threshold_mode: ThresholdMode,
    
    /// Blend mode for compositing
    pub blend_mode: BlendMode,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ThresholdMode {
    Range,
    Absolute,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum BlendMode {
    Over,
    Add,
    Max,
    Min,
}

/// Standard anatomical planes
const AXIAL_NORMAL: Vector3<f32> = Vector3::new(0.0, 0.0, 1.0);
const AXIAL_UP: Vector3<f32> = Vector3::new(0.0, 1.0, 0.0);

const CORONAL_NORMAL: Vector3<f32> = Vector3::new(0.0, 1.0, 0.0);
const CORONAL_UP: Vector3<f32> = Vector3::new(0.0, 0.0, -1.0);

const SAGITTAL_NORMAL: Vector3<f32> = Vector3::new(1.0, 0.0, 0.0);
const SAGITTAL_UP: Vector3<f32> = Vector3::new(0.0, 0.0, -1.0);

/// Resolve plane specification to normal and up vectors
pub fn resolve_plane(plane: Plane) -> (Vector3<f32>, Vector3<f32>) {
    match plane {
        Plane::Axial => (AXIAL_NORMAL, AXIAL_UP),
        Plane::Coronal => (CORONAL_NORMAL, CORONAL_UP),
        Plane::Sagittal => (SAGITTAL_NORMAL, SAGITTAL_UP),
        Plane::Custom { normal, up } => {
            // Ensure orthonormal
            let n = normal.normalize();
            let up_projection = n * up.dot(&n);
            let up_orthogonal = (up - up_projection).normalize();
            (n, up_orthogonal)
        }
    }
}

/// Convert slice position from mm to voxel index along a normal
pub fn slice_millimeters_to_index(
    slice_mm: f32,
    meta: &VolumeMeta,
    normal: &Vector3<f32>,
) -> f32 {
    // Simplified for axis-aligned normals
    if normal[0].abs() > 0.9 {
        // X axis
        (slice_mm - meta.origin[0]) / meta.spacing[0]
    } else if normal[1].abs() > 0.9 {
        // Y axis
        (slice_mm - meta.origin[1]) / meta.spacing[1]
    } else if normal[2].abs() > 0.9 {
        // Z axis
        (slice_mm - meta.origin[2]) / meta.spacing[2]
    } else {
        // For oblique planes, use average spacing
        let avg_spacing = (meta.spacing[0].abs() + 
                          meta.spacing[1].abs() + 
                          meta.spacing[2].abs()) / 3.0;
        slice_mm / avg_spacing
    }
}

/// Convert slice index to mm position along a normal
pub fn slice_index_to_millimeters(
    index: f32,
    meta: &VolumeMeta,
    normal: &Vector3<f32>,
) -> f32 {
    // Simplified for axis-aligned normals
    if normal[0].abs() > 0.9 {
        meta.origin[0] + index * meta.spacing[0]
    } else if normal[1].abs() > 0.9 {
        meta.origin[1] + index * meta.spacing[1]
    } else if normal[2].abs() > 0.9 {
        meta.origin[2] + index * meta.spacing[2]
    } else {
        // For oblique planes
        let avg_spacing = (meta.spacing[0].abs() + 
                          meta.spacing[1].abs() + 
                          meta.spacing[2].abs()) / 3.0;
        index * avg_spacing
    }
}

/// Calculate the field of view for a volume along a viewing plane
pub fn calculate_field_of_view(meta: &VolumeMeta, plane: Plane) -> (f32, f32) {
    let (normal, up) = resolve_plane(plane);
    let right = up.cross(&normal);
    
    // Calculate volume corners in world space
    let mut corners = Vec::new();
    for x in 0..=1 {
        for y in 0..=1 {
            for z in 0..=1 {
                let voxel = Vector3::new(
                    x as f32 * (meta.dims[0] - 1) as f32,
                    y as f32 * (meta.dims[1] - 1) as f32,
                    z as f32 * (meta.dims[2] - 1) as f32,
                );
                
                // Convert to world space
                let mut world = meta.origin + voxel.component_mul(&meta.spacing);
                
                // Apply direction matrix if present
                if let Some(dir) = &meta.direction {
                    let rotated = dir * voxel;
                    world = meta.origin + rotated.component_mul(&meta.spacing);
                }
                
                corners.push(world);
            }
        }
    }
    
    // Project corners onto plane axes
    let mut min_right = f32::INFINITY;
    let mut max_right = f32::NEG_INFINITY;
    let mut min_up = f32::INFINITY;
    let mut max_up = f32::NEG_INFINITY;
    
    for corner in &corners {
        let right_proj = corner.dot(&right);
        let up_proj = corner.dot(&up);
        
        min_right = min_right.min(right_proj);
        max_right = max_right.max(right_proj);
        min_up = min_up.min(up_proj);
        max_up = max_up.max(up_proj);
    }
    
    (max_right - min_right, max_up - min_up)
}

/// Create a ViewFrame for rendering a slice
pub fn make_frame(
    meta: &VolumeMeta,
    plane: Plane,
    slice_mm: f32,
    zoom: f32,
    pan: Vector2<f32>,
    viewport: Viewport,
) -> ViewFrame {
    let (normal, up) = resolve_plane(plane);
    let right = up.cross(&normal);
    
    // Calculate slice center in world space
    let slice_center = calculate_slice_center(meta, &normal, slice_mm);
    
    // Calculate field of view
    let (fov_width, fov_height) = calculate_field_of_view(meta, plane);
    
    // Add padding (20% on each side)
    let padding = 1.2;
    let padded_width = fov_width * padding;
    let padded_height = fov_height * padding;
    
    // Apply zoom
    let view_width = padded_width / zoom;
    let view_height = padded_height / zoom;
    
    // Calculate pixel size to maintain aspect ratio
    let pixel_size = (view_width / viewport.width as f32)
        .max(view_height / viewport.height as f32);
    
    // Calculate actual dimensions that will be rendered
    let render_width = viewport.width as f32 * pixel_size;
    let render_height = viewport.height as f32 * pixel_size;
    
    // Apply pan (convert from pixels to world units)
    let pan_world = pan * pixel_size;
    
    // Calculate origin (bottom-left corner in NDC = (0,0))
    let origin = slice_center 
        + right * (-render_width / 2.0 + pan_world.x)
        + up * (-render_height / 2.0 - pan_world.y); // Negative because Y is flipped
    
    // U and V vectors span the full viewport
    let u = right * render_width;
    let v = up * render_height;
    
    ViewFrame {
        origin,
        u,
        v,
        viewport,
    }
}

/// Calculate the center point of a slice in world space
fn calculate_slice_center(
    meta: &VolumeMeta,
    normal: &Vector3<f32>,
    slice_mm: f32,
) -> Vector3<f32> {
    // Volume center in voxel space
    let voxel_center = Vector3::new(
        (meta.dims[0] - 1) as f32 / 2.0,
        (meta.dims[1] - 1) as f32 / 2.0,
        (meta.dims[2] - 1) as f32 / 2.0,
    );
    
    // Convert to world space
    let mut world_center = meta.origin + voxel_center.component_mul(&meta.spacing);
    
    // Apply direction matrix if present
    if let Some(dir) = &meta.direction {
        let rotated = dir * voxel_center;
        world_center = meta.origin + rotated.component_mul(&meta.spacing);
    }
    
    // Project onto the slice plane
    // For axis-aligned planes, we just replace the appropriate coordinate
    if normal[0].abs() > 0.9 {
        world_center.x = slice_mm;
    } else if normal[1].abs() > 0.9 {
        world_center.y = slice_mm;
    } else if normal[2].abs() > 0.9 {
        world_center.z = slice_mm;
    } else {
        // For oblique planes, project center onto plane at slice distance
        let center_dist = world_center.dot(normal);
        let offset = slice_mm - center_dist;
        world_center += normal * offset;
    }
    
    world_center
}

/// Convert screen coordinates to world coordinates
pub fn screen_to_world(frame: &ViewFrame, screen_px: Vector2<f32>) -> Vector3<f32> {
    // Convert to NDC [0,1]
    let ndc_x = screen_px.x / frame.viewport.width as f32;
    let ndc_y = screen_px.y / frame.viewport.height as f32;
    
    // Calculate world position
    frame.origin + frame.u * ndc_x + frame.v * ndc_y
}

/// Convert world coordinates to screen coordinates
pub fn world_to_screen(frame: &ViewFrame, world_pos: &Vector3<f32>) -> Option<Vector2<f32>> {
    // Calculate relative position from origin
    let relative = world_pos - frame.origin;
    
    // Project onto u and v axes
    let u_length = frame.u.magnitude();
    let v_length = frame.v.magnitude();
    
    if u_length == 0.0 || v_length == 0.0 {
        return None;
    }
    
    let u_norm = frame.u / u_length;
    let v_norm = frame.v / v_length;
    
    let u_proj = relative.dot(&u_norm);
    let v_proj = relative.dot(&v_norm);
    
    // Convert to NDC
    let ndc_x = u_proj / u_length;
    let ndc_y = v_proj / v_length;
    
    // Check if within frame bounds
    if ndc_x < 0.0 || ndc_x > 1.0 || ndc_y < 0.0 || ndc_y > 1.0 {
        return None;
    }
    
    // Convert to screen pixels
    Some(Vector2::new(
        ndc_x * frame.viewport.width as f32,
        ndc_y * frame.viewport.height as f32,
    ))
}

/// Check if a world point is visible in the current frame
pub fn is_point_visible(frame: &ViewFrame, world_pos: &Vector3<f32>) -> bool {
    world_to_screen(frame, world_pos).is_some()
}

/// Get the slice distance (position along normal) for a world point
pub fn get_slice_distance(
    frame: &ViewFrame,
    world_pos: &Vector3<f32>,
    plane: Plane,
) -> f32 {
    let (_normal, _up) = resolve_plane(plane);
    
    // Calculate plane normal from frame (u × v)
    let frame_normal = frame.u.cross(&frame.v).normalize();
    
    // Get a point on the plane (frame origin)
    let plane_point = &frame.origin;
    
    // Calculate distance from world_pos to plane
    let to_point = world_pos - plane_point;
    to_point.dot(&frame_normal)
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;

    fn test_volume() -> VolumeMeta {
        VolumeMeta {
            dims: Vector3::new(10, 10, 10),
            spacing: Vector3::new(1.0, 1.0, 1.0),
            origin: Vector3::new(0.0, 0.0, 0.0),
            direction: None,
        }
    }

    #[test]
    fn test_resolve_plane() {
        let (normal, up) = resolve_plane(Plane::Axial);
        assert_eq!(normal, Vector3::new(0.0, 0.0, 1.0));
        assert_eq!(up, Vector3::new(0.0, 1.0, 0.0));

        let (normal, up) = resolve_plane(Plane::Coronal);
        assert_eq!(normal, Vector3::new(0.0, 1.0, 0.0));
        assert_eq!(up, Vector3::new(0.0, 0.0, -1.0));

        let (normal, up) = resolve_plane(Plane::Sagittal);
        assert_eq!(normal, Vector3::new(1.0, 0.0, 0.0));
        assert_eq!(up, Vector3::new(0.0, 0.0, -1.0));
    }

    #[test]
    fn test_slice_conversions() {
        let meta = test_volume();
        let normal = Vector3::new(0.0, 0.0, 1.0);

        // mm to index
        assert_eq!(slice_millimeters_to_index(0.0, &meta, &normal), 0.0);
        assert_eq!(slice_millimeters_to_index(5.0, &meta, &normal), 5.0);
        assert_eq!(slice_millimeters_to_index(9.0, &meta, &normal), 9.0);

        // index to mm
        assert_eq!(slice_index_to_millimeters(0.0, &meta, &normal), 0.0);
        assert_eq!(slice_index_to_millimeters(5.0, &meta, &normal), 5.0);
        assert_eq!(slice_index_to_millimeters(9.0, &meta, &normal), 9.0);
    }

    #[test]
    fn test_field_of_view() {
        let meta = test_volume();
        
        let (width, height) = calculate_field_of_view(&meta, Plane::Axial);
        assert_relative_eq!(width, 9.0);  // X dimension
        assert_relative_eq!(height, 9.0); // Y dimension

        let (width, height) = calculate_field_of_view(&meta, Plane::Coronal);
        assert_relative_eq!(width, 9.0);  // X dimension  
        assert_relative_eq!(height, 9.0); // Z dimension

        let (width, height) = calculate_field_of_view(&meta, Plane::Sagittal);
        assert_relative_eq!(width, 9.0);  // Y dimension
        assert_relative_eq!(height, 9.0); // Z dimension
    }

    #[test]
    fn test_make_frame() {
        let meta = test_volume();
        let viewport = Viewport { width: 512, height: 512 };
        
        let frame = make_frame(
            &meta,
            Plane::Axial,
            5.0, // middle slice
            1.0, // no zoom
            Vector2::new(0.0, 0.0), // no pan
            viewport,
        );

        // Origin should be at bottom-left of the view
        assert_relative_eq!(frame.origin.z, 5.0); // Z coordinate at slice
        
        // U vector should point along positive X
        assert!(frame.u.x > 0.0);
        assert_relative_eq!(frame.u.y, 0.0, epsilon = 1e-6);
        assert_relative_eq!(frame.u.z, 0.0, epsilon = 1e-6);
        
        // V vector should point along positive Y
        assert_relative_eq!(frame.v.x, 0.0, epsilon = 1e-6);
        assert!(frame.v.y > 0.0);
        assert_relative_eq!(frame.v.z, 0.0, epsilon = 1e-6);
        
        // Should maintain aspect ratio
        let u_length = frame.u.magnitude();
        let v_length = frame.v.magnitude();
        assert_relative_eq!(u_length, v_length, epsilon = 1e-3);
    }

    #[test]
    fn test_coordinate_transforms() {
        let meta = test_volume();
        let viewport = Viewport { width: 512, height: 512 };
        let frame = make_frame(
            &meta,
            Plane::Axial,
            5.0,
            1.0,
            Vector2::new(0.0, 0.0),
            viewport,
        );

        // Center of screen
        let center = screen_to_world(&frame, Vector2::new(256.0, 256.0));
        assert_relative_eq!(center.z, 5.0); // Z at slice
        assert_relative_eq!(center.x, 4.5, epsilon = 1.0); // Near X center
        assert_relative_eq!(center.y, 4.5, epsilon = 1.0); // Near Y center

        // Round-trip test
        let screen_points = vec![
            Vector2::new(100.0, 100.0),
            Vector2::new(256.0, 256.0),
            Vector2::new(400.0, 400.0),
        ];
        
        for point in screen_points {
            let world = screen_to_world(&frame, point);
            let back_to_screen = world_to_screen(&frame, &world);
            
            assert!(back_to_screen.is_some());
            if let Some(screen) = back_to_screen {
                assert_relative_eq!(screen.x, point.x, epsilon = 0.1);
                assert_relative_eq!(screen.y, point.y, epsilon = 0.1);
            }
        }
    }
}