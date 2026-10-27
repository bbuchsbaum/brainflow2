//! Raw-body IPC helpers for commands that receive bulk bytes.
//!
//! A JSON number array costs about four bytes of payload per byte and is
//! fully materialised before any size check. Commands that take binary data
//! (`save_image_bytes`, `export_population_plot`) instead take a raw
//! `Uint8Array` body; their small string arguments travel as
//! `encodeURIComponent`-encoded request headers:
//!
//! ```ts
//! invoke('plugin:api-bridge|save_image_bytes', bytes, {
//!   headers: { 'x-brainflow-suggested-name': encodeURIComponent(name) },
//! });
//! ```
use bridge_types::{BridgeError, BridgeResult};
use tauri::http::HeaderMap;
use tauri::ipc::InvokeBody;

fn invalid(details: impl Into<String>) -> BridgeError {
    BridgeError::Input {
        code: 6465,
        details: details.into(),
    }
}

/// The raw bytes of a request body (`request.body()`). A JSON body (for
/// example a number array from an older caller) is rejected explicitly.
pub(crate) fn raw_body<'a>(body: &'a InvokeBody, command: &str) -> BridgeResult<&'a [u8]> {
    match body {
        InvokeBody::Raw(bytes) => Ok(bytes),
        InvokeBody::Json(_) => Err(invalid(format!(
            "{command} expects the bytes as a raw Uint8Array body with arguments in \
             x-brainflow-* headers, not a JSON object."
        ))),
    }
}

/// Decode `%XX` escapes (as produced by `encodeURIComponent`) into UTF-8.
pub(crate) fn percent_decode(value: &str) -> BridgeResult<String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = bytes
                .get(i + 1..i + 3)
                .and_then(|h| std::str::from_utf8(h).ok())
                .and_then(|h| u8::from_str_radix(h, 16).ok())
                .ok_or_else(|| invalid("Malformed percent-encoding in a request header."))?;
            out.push(hex);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| invalid("A request header is not valid UTF-8."))
}

/// Percent-decoded value of header `name` (`request.headers()`), or `None`
/// when absent.
pub(crate) fn header(headers: &HeaderMap, name: &str) -> BridgeResult<Option<String>> {
    headers
        .get(name)
        .map(|value| {
            value
                .to_str()
                .map_err(|_| invalid(format!("Header {name} must be ASCII (percent-encoded).")))
                .and_then(percent_decode)
        })
        .transpose()
}

/// Like [`header`], but required.
pub(crate) fn required_header(headers: &HeaderMap, name: &str) -> BridgeResult<String> {
    header(headers, name)?.ok_or_else(|| invalid(format!("Missing request header {name}.")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::http::HeaderValue;

    #[test]
    fn decodes_encode_uri_component_output() {
        // encodeURIComponent("Résultats/fig 1.png")
        assert_eq!(
            percent_decode("R%C3%A9sultats%2Ffig%201.png").unwrap(),
            "Résultats/fig 1.png"
        );
        assert_eq!(percent_decode("plain-name").unwrap(), "plain-name");
        assert!(percent_decode("bad%2").is_err());
        assert!(percent_decode("bad%zz").is_err());
        assert!(percent_decode("%FF").is_err());
    }

    #[test]
    fn reads_raw_body_and_headers_and_rejects_json() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-brainflow-path",
            HeaderValue::from_static("%2Ftmp%2Fplot%20a.png"),
        );
        let raw = InvokeBody::Raw(vec![1, 2, 3]);
        assert_eq!(raw_body(&raw, "cmd").unwrap(), &[1, 2, 3]);
        assert_eq!(
            header(&headers, "x-brainflow-path").unwrap().as_deref(),
            Some("/tmp/plot a.png")
        );
        assert_eq!(header(&headers, "x-brainflow-format").unwrap(), None);
        assert!(required_header(&headers, "x-brainflow-format").is_err());

        let json = InvokeBody::Json(serde_json::json!({ "bytes": [1, 2, 3] }));
        let error = raw_body(&json, "save_image_bytes").unwrap_err().to_string();
        assert!(error.contains("raw Uint8Array body"), "{error}");
    }
}
