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

/// JPEG has no alpha channel: alpha is dropped. View frames are opaque (the
/// pass clears to opaque black), and dropping alpha stays correct if the
/// renderer ever produces premultiplied RGB.
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
        .flat_map(|px| [px[0], px[1], px[2]])
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

/// Write via a sibling temporary file, so a failed write never leaves a
/// truncated image. `overwrite = true` publishes with `rename`; otherwise the
/// temporary file is hard-linked into place, which fails atomically if the
/// target (or a dangling symlink) exists. Filesystems without hard links fall
/// back to a no-follow existence check followed by `rename`.
pub(crate) fn write_image(target: &Path, bytes: &[u8], overwrite: bool) -> BridgeResult<()> {
    let exists_error = || {
        invalid(format!(
            "{} already exists. Choose a new file name.",
            target.display()
        ))
    };
    if !overwrite && target.symlink_metadata().is_ok() {
        return Err(exists_error());
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
        if overwrite {
            return std::fs::rename(&temp, target);
        }
        match std::fs::hard_link(&temp, target) {
            Ok(()) => std::fs::remove_file(&temp),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Err(error),
            Err(_) if target.symlink_metadata().is_err() => std::fs::rename(&temp, target),
            Err(error) => Err(error),
        }
    })();
    if let Err(error) = result {
        let _ = std::fs::remove_file(&temp);
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            return Err(exists_error());
        }
        return Err(BridgeError::Io {
            code: 6462,
            details: format!("Could not save {}: {error}", target.display()),
        });
    }
    Ok(())
}

/// Write `bytes` to the destination picked in the save dialog. The dialog
/// confirmed overwriting `picked` only, so an existing file is replaced only
/// when the resolved target is that same path; if an extension had to be
/// appended (e.g. a bare name typed on Linux), an existing target is refused.
pub(crate) fn save_to_picked(
    picked: &Path,
    kind: ImageKind,
    bytes: &[u8],
) -> BridgeResult<PathBuf> {
    let target = resolve_target(picked, kind)?;
    let overwrite = target == picked;
    write_image(&target, bytes, overwrite)?;
    Ok(target)
}

/// Save an exported PNG/JPEG to a destination chosen in a native save dialog.
/// Returns the saved path, or `null` when the dialog is cancelled. There is
/// deliberately no path argument: writes always go through the dialog.
#[command]
#[tracing::instrument(skip_all, err, name = "api.save_image_bytes")]
pub(crate) async fn save_image_bytes<R: Runtime>(
    app: tauri::AppHandle<R>,
    bytes: Vec<u8>,
    suggested_name: Option<String>,
) -> BridgeResult<Option<String>> {
    let kind = validate_image_bytes(&bytes)?;
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
    let target = tokio::task::spawn_blocking(move || save_to_picked(&picked, kind, &bytes))
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
        // A dangling symlink counts as an existing target without overwrite.
        #[cfg(unix)]
        {
            let link = dir.join("dangling.png");
            std::os::unix::fs::symlink(dir.join("nowhere.png"), &link).unwrap();
            assert!(write_image(&link, b"x", false).is_err());
            assert!(!dir.join("nowhere.png").exists());
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn dialog_overwrite_applies_only_to_the_confirmed_path() {
        let dir = std::env::temp_dir().join(format!("bf-export-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let existing = dir.join("figure.png");
        std::fs::write(&existing, b"original").unwrap();
        // Bare name: the dialog confirmed "figure", not "figure.png".
        assert!(save_to_picked(&dir.join("figure"), ImageKind::Png, b"new").is_err());
        assert_eq!(std::fs::read(&existing).unwrap(), b"original");
        // The exact confirmed path may be replaced.
        let saved = save_to_picked(&existing, ImageKind::Png, b"new").unwrap();
        assert_eq!(saved, existing);
        assert_eq!(std::fs::read(&existing).unwrap(), b"new");
        // A bare name with no conflict gets the extension appended.
        let fresh = save_to_picked(&dir.join("other"), ImageKind::Jpeg, b"jpg").unwrap();
        assert_eq!(fresh, dir.join("other.jpg"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn jpeg_drops_alpha_instead_of_darkening() {
        // Half-transparent white must stay white (alpha ignored).
        let jpeg = encode_jpeg_frame(8, 8, &[255, 255, 255, 128].repeat(64)).unwrap();
        let decoded = image::load_from_memory_with_format(&jpeg, image::ImageFormat::Jpeg)
            .unwrap()
            .to_rgb8();
        assert!(decoded.pixels().all(|p| p.0.iter().all(|&c| c > 245)));
    }
}
