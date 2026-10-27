//! Bounded plot exports to an explicit user-chosen new file.
use bridge_types::{BridgeError, BridgeResult};
use std::{
    fs::OpenOptions,
    io::{Cursor, Write},
    path::Path,
};
fn invalid(message: &str) -> BridgeError {
    BridgeError::Input {
        code: 6451,
        details: message.into(),
    }
}
/// Largest accepted plot export.
pub const MAX_PLOT_BYTES: usize = 16 * 1024 * 1024;

pub fn save(path: &str, bytes: &[u8], format: &str) -> BridgeResult<String> {
    let path = Path::new(path);
    if !path.is_absolute()
        || bytes.is_empty()
        || bytes.len() > MAX_PLOT_BYTES
        || path.extension().and_then(|s| s.to_str()) != Some(format)
    {
        return Err(invalid(
            "Choose an absolute .png or .json output path; plot exports are limited to 16 MiB.",
        ));
    }
    match format {
        "png" => {
            let (w, h) =
                image::ImageReader::with_format(Cursor::new(bytes), image::ImageFormat::Png)
                    .into_dimensions()
                    .map_err(|_| invalid("Invalid PNG plot."))?;
            if w == 0 || h == 0 || u64::from(w) * u64::from(h) > 16_000_000 {
                return Err(invalid("Plot export exceeds 16 million pixels."));
            }
            image::load_from_memory_with_format(bytes, image::ImageFormat::Png)
                .map_err(|_| invalid("Invalid PNG plot pixels."))?;
        }
        "json" => {
            let value: serde_json::Value =
                serde_json::from_slice(bytes).map_err(|_| invalid("Invalid plot JSON."))?;
            if value["schema"] != "brainflow.population-plot.v1" || !value["plot"].is_object() {
                return Err(invalid("Unsupported population plot receipt."));
            }
        }
        _ => {
            return Err(invalid(
                "Only PNG graphics and JSON plot receipts are supported.",
            ))
        }
    }
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .map_err(|e| {
            invalid(&format!(
                "Could not create a new plot file: {e}. Choose a new filename."
            ))
        })?;
    if let Err(e) = file.write_all(bytes).and_then(|()| file.sync_all()) {
        drop(file);
        let _ = std::fs::remove_file(path);
        return Err(e.into());
    }
    Ok(path.to_string_lossy().into_owned())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn writes_new_valid_png_and_refuses_overwrite_or_arbitrary_receipt() {
        let path =
            std::env::temp_dir().join(format!("population-plot-{}.png", uuid::Uuid::new_v4()));
        let mut bytes = Cursor::new(Vec::new());
        image::DynamicImage::new_rgba8(2, 2)
            .write_to(&mut bytes, image::ImageFormat::Png)
            .unwrap();
        save(path.to_str().unwrap(), bytes.get_ref(), "png").unwrap();
        assert!(save(path.to_str().unwrap(), bytes.get_ref(), "png").is_err());
        assert_eq!(std::fs::read(&path).unwrap(), *bytes.get_ref());
        std::fs::remove_file(&path).unwrap();
        assert!(save(path.to_str().unwrap(), b"broken", "png").is_err());
        assert!(!path.exists());
        assert!(save(path.with_extension("json").to_str().unwrap(), b"{}", "json").is_err());
    }
}
