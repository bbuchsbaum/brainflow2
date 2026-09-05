//! File decoding stays off async command workers. Geometry is retained from the
//! first decode instead of decoding once for detection and again for storage.
use bridge_types::{BridgeResult, Loaded, Loader, SurfaceHandle};
use neurosurf_rs::geometry::SurfaceGeometry;
use std::path::Path;

pub(crate) fn decode(path: &Path) -> BridgeResult<(Loaded, Option<SurfaceGeometry>)> {
    match gifti_loader::load_gifti_surface(path) {
        Ok(geometry) => {
            let loaded = Loaded::Surface {
                handle: SurfaceHandle(uuid::Uuid::new_v4().to_string()),
                vertex_count: geometry.vertex_count(),
                face_count: geometry.face_count(),
                path: path.to_string_lossy().into_owned(),
            };
            Ok((loaded, Some(geometry)))
        }
        Err(_) => {
            // Preserve data-only GIfTI dispatch and existing error messages.
            Ok((gifti_loader::GiftiLoader::load(path)?, None))
        }
    }
}
