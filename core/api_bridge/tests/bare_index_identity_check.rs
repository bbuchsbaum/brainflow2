//! CI guard for R2 of `docs/plans/gpu-residency-implementation-2026-11.md`:
//! outside the residency modules, no code in `core/api_bridge/src` names a GPU
//! texture by its bare `u32` index. Ownership, release, edits and liveness go
//! through generation-checked `SlotHandle`s (see `LayerSlotMap`); an index may
//! still reach the renderer as a binding position, taken from a current handle.
//!
//! The check scans code only: comments, string and char literals and
//! `#[cfg(test)]` items are blanked first (tests simulate stale slots on
//! purpose). Each rule names the calls that take or mint an identity from a
//! bare index.
//!
//! Allowlist ([`ALLOWED`]): `residency/` (leases, rings' accounts, the release
//! path, the watchdog) and `gpu_upload.rs` (the upload functions, which turn a
//! fresh index into a handle under the service lock). Adding a file here needs
//! the same justification: it owns residency, not a consumer of it.

use std::path::{Path, PathBuf};

/// Paths (relative to `src/`, `/`-separated) where bare-index residency APIs
/// are allowed. A trailing `/` allows a directory.
const ALLOWED: &[&str] = &["residency/", "gpu_upload.rs"];

struct Rule {
    pattern: &'static str,
    /// Allowed in [`ALLOWED`] paths; `false` forbids it everywhere.
    allowlisted: bool,
    why: &'static str,
}

const RULES: &[Rule] = &[
    Rule {
        pattern: "layer_to_atlas_map",
        allowlisted: false,
        why: "the layer map holds SlotHandles: use `BridgeState::layer_slots` (`LayerSlotMap`)",
    },
    Rule {
        pattern: ".release_volume(",
        allowlisted: true,
        why: "releases whatever now fills an index: release a `SlotHandle` (`release_slot`)",
    },
    Rule {
        pattern: ".release_layer_resources(",
        allowlisted: true,
        why: "releases whatever now fills an index: use `release_layer_slot(handle)`",
    },
    Rule {
        pattern: ".slot_handle(",
        allowlisted: true,
        why: "mints an identity from a bare index: keep the handle the upload returned",
    },
    Rule {
        pattern: "editable_handle_for_volume(",
        allowlisted: true,
        why: "looks an editable claim up by index: use `gpu_upload::editable_handle_at(slot)`",
    },
    Rule {
        pattern: "is_volume_slot_resident(",
        allowlisted: true,
        why: "tests an index, not the layer's residency: use `LayerSlotMap::current`",
    },
    Rule {
        pattern: "is_editable_volume_slot(",
        allowlisted: true,
        why: "tests an index, not a residency: resolve a `SlotHandle` first",
    },
];

/// A `HashMap<String, u32>` whose line mentions a texture is a layer → bare
/// index map: the shape `LayerSlotMap` replaced.
const BARE_MAP: &str = "HashMap<String, u32>";
const BARE_MAP_HINTS: &[&str] = &["atlas", "slot", "texture"];

#[derive(Debug, PartialEq)]
struct Violation {
    path: String,
    line: usize,
    pattern: &'static str,
    why: &'static str,
}

fn allowlisted(path: &str) -> bool {
    ALLOWED.iter().any(|allowed| {
        if allowed.ends_with('/') {
            path.starts_with(allowed)
        } else {
            path == *allowed
        }
    })
}

/// `source` with comments, string/char literals and the bodies of
/// `#[cfg(test)]` items replaced by spaces; line breaks are kept.
fn code_only(source: &str) -> String {
    let chars: Vec<char> = source.chars().collect();
    let mut out: Vec<char> = chars.clone();
    let blank = |out: &mut Vec<char>, from: usize, to: usize| {
        for c in &mut out[from..to] {
            if *c != '\n' {
                *c = ' ';
            }
        }
    };
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let next = chars.get(i + 1).copied();
        if c == '/' && next == Some('/') {
            let end = chars[i..]
                .iter()
                .position(|&c| c == '\n')
                .map_or(chars.len(), |p| i + p);
            blank(&mut out, i, end);
            i = end;
        } else if c == '/' && next == Some('*') {
            let mut depth = 0;
            let mut j = i;
            while j < chars.len() {
                if chars[j] == '/' && chars.get(j + 1) == Some(&'*') {
                    depth += 1;
                    j += 2;
                } else if chars[j] == '*' && chars.get(j + 1) == Some(&'/') {
                    depth -= 1;
                    j += 2;
                    if depth == 0 {
                        break;
                    }
                } else {
                    j += 1;
                }
            }
            blank(&mut out, i, j);
            i = j;
        } else if c == 'r'
            && matches!(next, Some('"') | Some('#'))
            && (i == 0 || !(chars[i - 1].is_alphanumeric() || chars[i - 1] == '_'))
        {
            // Raw string: r"..", r#".."#.
            let mut j = i + 1;
            let mut hashes = 0;
            while chars.get(j) == Some(&'#') {
                hashes += 1;
                j += 1;
            }
            if chars.get(j) != Some(&'"') {
                i += 1;
                continue;
            }
            j += 1;
            loop {
                if j >= chars.len() {
                    break;
                }
                if chars[j] == '"' && (0..hashes).all(|h| chars.get(j + 1 + h) == Some(&'#')) {
                    j += 1 + hashes;
                    break;
                }
                j += 1;
            }
            blank(&mut out, i, j);
            i = j;
        } else if c == '"' {
            let mut j = i + 1;
            while j < chars.len() && chars[j] != '"' {
                j += if chars[j] == '\\' { 2 } else { 1 };
            }
            let end = (j + 1).min(chars.len());
            blank(&mut out, i, end);
            i = end;
        } else if c == '\'' {
            // A char literal ('x', '\n', '\u{..}'), or a lifetime ('a).
            if next == Some('\\') {
                let end = chars[i + 2..]
                    .iter()
                    .position(|&c| c == '\'')
                    .map_or(chars.len(), |p| i + 2 + p + 1);
                blank(&mut out, i, end);
                i = end;
            } else if chars.get(i + 2) == Some(&'\'') {
                blank(&mut out, i, i + 3);
                i += 3;
            } else {
                i += 1;
            }
        } else {
            i += 1;
        }
    }
    let code: String = out.into_iter().collect();
    strip_test_items(&code)
}

/// Blank every item gated by `#[cfg(test)]`: up to its `;` or to the brace
/// closing its body. `code` has no comments or literals left.
fn strip_test_items(code: &str) -> String {
    let mut out: Vec<char> = code.chars().collect();
    let marker: Vec<char> = "#[cfg(test)]".chars().collect();
    let mut i = 0;
    while i + marker.len() <= out.len() {
        if out[i..i + marker.len()] != marker[..] {
            i += 1;
            continue;
        }
        let mut j = i + marker.len();
        let mut depth = 0usize;
        while j < out.len() {
            match out[j] {
                '{' => depth += 1,
                '}' if depth == 0 => break,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        j += 1;
                        break;
                    }
                }
                ';' if depth == 0 => {
                    j += 1;
                    break;
                }
                _ => {}
            }
            j += 1;
        }
        let end = j.min(out.len());
        for c in &mut out[i..end] {
            if *c != '\n' {
                *c = ' ';
            }
        }
        i = j;
    }
    out.into_iter().collect()
}

fn violations(path: &str, source: &str) -> Vec<Violation> {
    let allowed = allowlisted(path);
    let mut found = Vec::new();
    for (number, line) in code_only(source).lines().enumerate() {
        for rule in RULES {
            if line.contains(rule.pattern) && !(rule.allowlisted && allowed) {
                found.push(Violation {
                    path: path.to_owned(),
                    line: number + 1,
                    pattern: rule.pattern,
                    why: rule.why,
                });
            }
        }
        let lower = line.to_ascii_lowercase();
        if !allowed
            && line.contains(BARE_MAP)
            && BARE_MAP_HINTS.iter().any(|hint| lower.contains(hint))
        {
            found.push(Violation {
                path: path.to_owned(),
                line: number + 1,
                pattern: BARE_MAP,
                why: "a layer → bare texture index map: record `SlotHandle`s (`LayerSlotMap`)",
            });
        }
    }
    found
}

fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(dir).expect("readable source directory") {
        let path = entry.expect("directory entry").path();
        if path.is_dir() {
            rust_files(&path, out);
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            out.push(path);
        }
    }
}

#[test]
fn no_bare_texture_index_identity_outside_the_residency_modules() {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut files = Vec::new();
    rust_files(&src, &mut files);
    assert!(files.len() > 20, "scanned the crate's sources");
    let mut found = Vec::new();
    for file in files {
        let relative = file
            .strip_prefix(&src)
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/");
        let source = std::fs::read_to_string(&file).expect("readable source");
        found.extend(violations(&relative, &source));
    }
    let report: Vec<String> = found
        .iter()
        .map(|v| format!("src/{}:{}: `{}`: {}", v.path, v.line, v.pattern, v.why))
        .collect();
    assert!(
        report.is_empty(),
        "bare texture-index identity outside residency/ and gpu_upload.rs:\n{}",
        report.join("\n")
    );
}

#[test]
fn the_scanner_flags_bare_index_identity_in_consumer_code() {
    let source = r#"
fn release(state: &BridgeState, service: &mut RenderLoopService, index: u32) {
    let map = state.layer_to_atlas_map.lock();
    service.release_volume(index).unwrap();
    service.release_layer_resources(index).unwrap();
    let handle = service.slot_handle(index);
    let ready = service.is_volume_slot_resident(index);
}
struct Owner {
    atlas: HashMap<String, u32>,
}
"#;
    let found: Vec<_> = violations("lib.rs", source)
        .into_iter()
        .map(|v| (v.line, v.pattern))
        .collect();
    assert_eq!(
        found,
        vec![
            (3, "layer_to_atlas_map"),
            (4, ".release_volume("),
            (5, ".release_layer_resources("),
            (6, ".slot_handle("),
            (7, "is_volume_slot_resident("),
            (10, BARE_MAP),
        ]
    );
    // The allowlist covers the residency APIs, never the old map.
    let allowed: Vec<_> = violations("residency/release.rs", source)
        .into_iter()
        .map(|v| v.pattern)
        .collect();
    assert_eq!(allowed, vec!["layer_to_atlas_map"]);
}

#[test]
fn the_scanner_ignores_comments_literals_tests_and_handles() {
    let source = r##"
// state.layer_to_atlas_map once held bare indices; release_volume( freed them.
/* service.release_volume(index) */
/// Doc: `service.slot_handle(index)` mints a handle.
fn release(service: &mut RenderLoopService, slot: SlotHandle, chars: &[char]) {
    service.release_slot(slot).unwrap();
    service.release_layer_slot(slot).unwrap();
    let text = "service.release_volume(3) and layer_to_atlas_map";
    let raw = r#"service.slot_handle(1) "quoted" HashMap<String, u32> atlas"#;
    let brace = '{';
    let lifetime: &'static str = "x";
    let names: HashMap<String, u32> = HashMap::new();
    let _ = chars.contains(&'}');
}

#[cfg(test)]
mod tests {
    #[test]
    fn simulates_a_stale_slot() {
        let format = format!("{}", '{');
        service.release_volume(index).unwrap();
        state.layer_to_atlas_map.lock();
    }
}

#[cfg(test)]
use crate::release_volume_for_test;

fn after_tests(service: &mut RenderLoopService, index: u32) {
    service.release_volume(index).unwrap();
}
"##;
    let found: Vec<_> = violations("lib.rs", source)
        .into_iter()
        .map(|v| (v.line, v.pattern))
        .collect();
    // Only the call after the test items: the stripping stops where they end.
    assert_eq!(found, vec![(30, ".release_volume(")]);
}
