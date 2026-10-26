//! Still-image export: JPEG encoding of rendered frames and the
//! `save_image_bytes` command that writes an exported view to a user-chosen file.
use crate::RenderFormat;
use bridge_types::{BridgeError, BridgeResult};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{command, Runtime};
use tauri_plugin_dialog::DialogExt;

/// Largest image `save_image_bytes` accepts.
const MAX_IMAGE_BYTES: usize = 256 * 1024 * 1024;
const JPEG_QUALITY: u8 = 92;

/// Encode an RGBA8 frame as the requested still format (PNG or JPEG).
pub(crate) fn encode_still_frame(
    format: RenderFormat,
    width: u32,
    height: u32,
    rgba: Vec<u8>,
) -> BridgeResult<Vec<u8>> {
    match format {
        RenderFormat::Jpeg => encode_jpeg_frame(width, height, &rgba),
        _ => crate::render_bridge_adapter::encode_png_frame(width, height, rgba),
    }
}

/// JPEG has no alpha: composite onto black (the viewer background) first.
pub(crate) fn encode_jpeg_frame(width: u32, height: u32, rgba: &[u8]) -> BridgeResult<Vec<u8>> {
    let expected = width as usize * height as usize * 4;
    if rgba.len() != expected || width == 0 || height == 0 {
        return Err(BridgeError::Internal {
            code: 5023,
            details: format!(
                "JPEG encode expected {expected} RGBA bytes for {width}x{height}, got {}",
                rgba.len()
            ),
        });
    }
    let rgb: Vec<u8> = rgba
        .chunks_exact(4)
        .flat_map(|px| {
            let a = u16::from(px[3]);
            [0, 1, 2].map(|c| ((u16::from(px[c]) * a + 127) / 255) as u8)
        })
        .collect();
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY)
        .encode(&rgb, width, height, image::ExtendedColorType::Rgb8)
        .map_err(|e| BridgeError::Internal {
            code: 5024,
            details: format!("JPEG encoding failed: {e}"),
        })?;
    Ok(out)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ImageKind {
    Png,
    Jpeg,
}

impl ImageKind {
    fn sniff(bytes: &[u8]) -> Option<Self> {
        if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            Some(Self::Png)
        } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
            Some(Self::Jpeg)
        } else {
            None
        }
    }

    fn extension(self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Jpeg => "jpg",
        }
    }

    fn accepts_extension(self, ext: &str) -> bool {
        match self {
            Self::Png => ext == "png",
            Self::Jpeg => ext == "jpg" || ext == "jpeg",
        }
    }

    fn filter_name(self) -> &'static str {
        match self {
            Self::Png => "PNG image",
            Self::Jpeg => "JPEG image",
        }
    }
}

fn invalid(details: impl Into<String>) -> BridgeError {
    BridgeError::Input {
        code: 6461,
        details: details.into(),
    }
}

pub(crate) fn validate_image_bytes(bytes: &[u8]) -> BridgeResult<ImageKind> {
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err(invalid("Image exports must be between 1 byte and 256 MiB."));
    }
    ImageKind::sniff(bytes).ok_or_else(|| invalid("Only PNG and JPEG images can be saved."))
}

/// Default file name: the suggestion's stem (path components stripped) with
/// the extension that matches the bytes.
pub(crate) fn default_file_name(suggested: Option<&str>, kind: ImageKind) -> String {
    let stem = suggested
        .and_then(|name| Path::new(name).file_stem())
        .and_then(|stem| stem.to_str())
        .filter(|stem| !stem.trim().is_empty())
        .unwrap_or("brainflow-view");
    format!("{stem}.{}", kind.extension())
}

/// Normalise the target: absolute, extension matching the content (appended
/// when missing).
pub(crate) fn resolve_target(path: &Path, kind: ImageKind) -> BridgeResult<PathBuf> {
    if !path.is_absolute() {
        return Err(invalid("Choose an absolute output path."));
    }
    match path.extension().and_then(|e| e.to_str()) {
        None => Ok(path.with_extension(kind.extension())),
        Some(ext) if kind.accepts_extension(&ext.to_ascii_lowercase()) => Ok(path.to_path_buf()),
        Some(ext) => Err(invalid(format!(
            "The file extension .{ext} does not match the {} data.",
            kind.filter_name()
        ))),
    }
}

/// Write via a sibling temporary file and rename, so a failed write never
/// leaves a truncated image. `overwrite = false` refuses an existing target.
pub(crate) fn write_image(target: &Path, bytes: &[u8], overwrite: bool) -> BridgeResult<()> {
    if !overwrite && target.exists() {
        return Err(invalid(format!(
            "{} already exists. Choose a new file name.",
            target.display()
        )));
    }
    let parent = target
        .parent()
        .filter(|p| p.is_dir())
        .ok_or_else(|| invalid("The output folder does not exist."))?;
    let temp = parent.join(format!(".brainflow-export-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> std::io::Result<()> {
        let mut file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        std::fs::rename(&temp, target)
    })();
    if let Err(error) = result {
        let _ = std::fs::remove_file(&temp);
        return Err(BridgeError::Io {
            code: 6462,
            details: format!("Could not save {}: {error}", target.display()),
        });
    }
    Ok(())
}

/// Save an exported PNG/JPEG. Without `path`, a native save dialog asks for
/// the destination (the dialog confirms overwrites); with `path`, the file must
/// not exist yet. Returns the saved path, or `null` when the dialog is
/// cancelled.
#[command]
#[tracing::instrument(skip_all, err, name = "api.save_image_bytes")]
pub(crate) async fn save_image_bytes<R: Runtime>(
    app: tauri::AppHandle<R>,
    bytes: Vec<u8>,
    suggested_name: Option<String>,
    path: Option<String>,
) -> BridgeResult<Option<String>> {
    let kind = validate_image_bytes(&bytes)?;
    let (chosen, overwrite) = match path {
        Some(path) => (PathBuf::from(path), false),
        None => {
            let (tx, rx) = tokio::sync::oneshot::channel();
            app.dialog()
                .file()
                .set_title("Export view")
                .set_file_name(default_file_name(suggested_name.as_deref(), kind))
                .add_filter(kind.filter_name(), &[kind.extension()])
                .save_file(move |picked| {
                    let _ = tx.send(picked);
                });
            let picked = rx.await.map_err(|_| BridgeError::Internal {
                code: 6463,
                details: "Save dialog closed without a response".into(),
            })?;
            let Some(picked) = picked else {
                return Ok(None);
            };
            let picked = picked
                .into_path()
                .map_err(|e| invalid(format!("Unsupported save location: {e}")))?;
            (picked, true)
        }
    };
    let target = resolve_target(&chosen, kind)?;
    let write_target = target.clone();
    tokio::task::spawn_blocking(move || write_image(&write_target, &bytes, overwrite))
        .await
        .map_err(|e| BridgeError::Internal {
            code: 6464,
            details: format!("Image save task failed: {e}"),
        })??;
    Ok(Some(target.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn checker_rgba(width: u32, height: u32) -> Vec<u8> {
        (0..width * height)
            .flat_map(|i| {
                if i % 2 == 0 {
                    [255, 0, 0, 255]
                } else {
                    [0, 0, 255, 255]
                }
            })
            .collect()
    }

    #[test]
    fn jpeg_frames_are_real_jpeg() {
        let jpeg = encode_still_frame(RenderFormat::Jpeg, 8, 4, checker_rgba(8, 4)).unwrap();
        assert_eq!(&jpeg[..2], &[0xFF, 0xD8]);
        assert_eq!(&jpeg[jpeg.len() - 2..], &[0xFF, 0xD9]);
        assert_eq!(ImageKind::sniff(&jpeg), Some(ImageKind::Jpeg));
        let png = encode_still_frame(RenderFormat::Png, 8, 4, checker_rgba(8, 4)).unwrap();
        assert_eq!(ImageKind::sniff(&png), Some(ImageKind::Png));
        assert!(encode_jpeg_frame(8, 4, &[0; 10]).is_err());
    }

    #[test]
    fn render_format_parses_jpeg_aliases() {
        assert_eq!(RenderFormat::from_str("jpg"), Some(RenderFormat::Jpeg));
        assert_eq!(RenderFormat::from_str("JPEG"), Some(RenderFormat::Jpeg));
        assert_eq!(RenderFormat::from_str("png"), Some(RenderFormat::Png));
        assert_eq!(RenderFormat::Jpeg.label(), "jpeg");
    }

    #[test]
    fn validates_content_and_extension() {
        assert!(validate_image_bytes(&[]).is_err());
        assert!(validate_image_bytes(b"GIF89a").is_err());
        let png = ImageKind::Png;
        assert_eq!(
            resolve_target(Path::new("/tmp/view"), png).unwrap(),
            PathBuf::from("/tmp/view.png")
        );
        assert!(resolve_target(Path::new("/tmp/view.jpg"), png).is_err());
        assert!(resolve_target(Path::new("relative.png"), png).is_err());
        assert!(resolve_target(Path::new("/tmp/view.JPEG"), ImageKind::Jpeg).is_ok());
        assert_eq!(
            default_file_name(Some("../evil/axial-123.png"), ImageKind::Jpeg),
            "axial-123.jpg"
        );
        assert_eq!(default_file_name(None, png), "brainflow-view.png");
    }

    #[test]
    fn writes_atomically_and_respects_overwrite_flag() {
        let dir = std::env::temp_dir().join(format!("bf-export-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("view.png");
        write_image(&target, b"first", false).unwrap();
        assert!(write_image(&target, b"second", false).is_err());
        write_image(&target, b"second", true).unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"second");
        // Only the target remains: no temporary files left behind.
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        assert!(write_image(&dir.join("missing/view.png"), b"x", false).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
