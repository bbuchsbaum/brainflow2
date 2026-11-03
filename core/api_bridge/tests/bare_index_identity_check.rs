//! CI guard for R2 of `docs/plans/gpu-residency-implementation-2026-11.md`:
//! outside the residency modules, no code in `core/api_bridge/src` names a GPU
//! texture by its bare `u32` index. Ownership, release, edits and liveness go
//! through generation-checked `SlotHandle`s (see `LayerSlotMap`); an index may
//! still reach the renderer as a binding position, taken from a current handle.
//!
//! The check scans code only: comments, string and char literals and
//! `#[cfg(test)]` items are blanked first (tests simulate stale slots on
//! purpose). Each rule names the calls that take or mint an identity from a
//! bare index, and a map rule catches layer → bare index maps.
//!
//! Allowlist ([`ALLOWED`]): all of `residency/` (leases, rings' accounts, the
//! release path, the watchdog), and in `gpu_upload.rs` only the functions that
//! turn a fresh index into a handle (`upload_layer_volume`) or check a claim
//! against one (`editable_handle_at`). An addition needs the same
//! justification: it owns residency, it is not a consumer of it.
//!
//! Known gaps (not detectable precisely enough to enforce without false
//! positives): a bare `u32`/`usize` struct field or local that holds a slot
//! index, and `.index()` used as a map key or compared as an identity. Review
//! catches those; the type of `LayerSlotMap` and the handle-taking renderer
//! APIs make them the unusual path.

use std::path::{Path, PathBuf};

/// Where bare-index residency APIs are allowed, by path relative to `src/`
/// (`/`-separated; a trailing `/` allows a directory) and, optionally, only
/// inside the named functions.
const ALLOWED: &[(&str, Option<&[&str]>)] = &[
    ("residency/", None),
    (
        "gpu_upload.rs",
        Some(&["upload_layer_volume", "editable_handle_at"]),
    ),
];

struct Rule {
    pattern: &'static str,
    /// Allowed in [`ALLOWED`] code; `false` forbids it everywhere.
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
    Rule {
        pattern: "remove_layer_by_atlas(",
        allowlisted: true,
        why: "removes whichever render entry samples an index: use `release_layer_slot(handle)`",
    },
    Rule {
        pattern: "find_layer_index_by_atlas(",
        allowlisted: true,
        why: "finds a render entry by index: use `residency::drawn_render_layer(service, slot)`",
    },
    Rule {
        pattern: "render_layer_index_for_atlas(",
        allowlisted: true,
        why: "finds a render entry by index: use `residency::drawn_render_layer(service, slot)`",
    },
];

/// The map rule: a `HashMap`/`BTreeMap` from a string key to `u32`/`usize`
/// whose text mentions a texture is a layer → bare index map, the shape
/// `LayerSlotMap` replaced.
const BARE_MAP: &str = "map<string key, bare index>";
const MAP_TYPES: &[&str] = &["HashMap<", "BTreeMap<"];
const INDEX_TYPES: &[&str] = &["u32", "usize"];
const BARE_MAP_HINTS: &[&str] = &["atlas", "slot", "texture"];

#[derive(Debug, PartialEq)]
struct Violation {
    path: String,
    line: usize,
    pattern: &'static str,
    why: &'static str,
}

/// `source` with comments, string/char literals and `#[cfg(test)]` items
/// replaced by spaces; line breaks are kept.
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

/// The end (exclusive) of the item starting at `from` in `code` (no comments
/// or literals left): its `;`, the brace closing its body, or, for a field or
/// variant, its `,` (outside brackets and generics) or the `}` closing the
/// enclosing struct or enum, which stays.
fn item_end(code: &[char], from: usize) -> usize {
    let (mut braces, mut parens, mut angles) = (0usize, 0usize, 0usize);
    let mut j = from;
    while j < code.len() {
        match code[j] {
            '{' => braces += 1,
            '}' if braces == 0 => return j,
            '}' => {
                braces -= 1;
                if braces == 0 {
                    return j + 1;
                }
            }
            '(' | '[' => parens += 1,
            ')' | ']' => parens = parens.saturating_sub(1),
            // Generics in a signature or field type; `->` is not one.
            '<' if braces == 0 => angles += 1,
            '>' if braces == 0 && j > 0 && code[j - 1] != '-' && code[j - 1] != '=' => {
                angles = angles.saturating_sub(1)
            }
            ';' if braces == 0 => return j + 1,
            ',' if braces == 0 && parens == 0 && angles == 0 => return j + 1,
            _ => {}
        }
        j += 1;
    }
    code.len()
}

/// Blank every item gated by `#[cfg(test)]`. `code` has no comments or
/// literals left.
fn strip_test_items(code: &str) -> String {
    let mut out: Vec<char> = code.chars().collect();
    let marker: Vec<char> = "#[cfg(test)]".chars().collect();
    let mut i = 0;
    while i + marker.len() <= out.len() {
        if out[i..i + marker.len()] != marker[..] {
            i += 1;
            continue;
        }
        let end = item_end(&out, i + marker.len());
        for c in &mut out[i..end] {
            if *c != '\n' {
                *c = ' ';
            }
        }
        i = end.max(i + 1);
    }
    out.into_iter().collect()
}

/// Line ranges (0-based, inclusive) of the bodies of functions named `names`.
fn function_lines(code: &str, names: &[&str]) -> Vec<(usize, usize)> {
    let chars: Vec<char> = code.chars().collect();
    let line_of = |at: usize| chars[..at].iter().filter(|&&c| c == '\n').count();
    let mut spans = Vec::new();
    for name in names {
        let needle = format!("fn {name}");
        let mut search = 0;
        while let Some(found) = code[search..].find(&needle) {
            let start = search + found;
            search = start + needle.len();
            let follows = code[search..].chars().next();
            if !matches!(follows, Some('(') | Some('<')) {
                continue;
            }
            let at = code[..start].chars().count();
            spans.push((line_of(at), line_of(item_end(&chars, at).saturating_sub(1))));
        }
    }
    spans
}

fn allowed_lines(path: &str, code: &str) -> Option<Vec<(usize, usize)>> {
    ALLOWED.iter().find_map(|(allowed, functions)| {
        let matches = if allowed.ends_with('/') {
            path.starts_with(allowed)
        } else {
            path == *allowed
        };
        matches.then(|| match functions {
            None => vec![(0, usize::MAX)],
            Some(names) => function_lines(code, names),
        })
    })
}

/// Whether `line` declares a string → index map whose own declaration (the
/// text naming it, back to the previous `,` `;` `(` `{` or `=`) mentions a
/// texture. The map type may wrap onto `rest`; whitespace is ignored.
fn declares_bare_index_map(line: &str, rest: &str) -> bool {
    MAP_TYPES.iter().any(|map| {
        line.match_indices(map).any(|(at, _)| {
            let named_by = line[..at]
                .rsplit([',', ';', '(', '{', '='])
                .next()
                .unwrap_or("")
                .to_ascii_lowercase();
            if !BARE_MAP_HINTS.iter().any(|hint| named_by.contains(hint)) {
                return false;
            }
            let compact: String = format!("{} {rest}", &line[at + map.len()..])
                .chars()
                .filter(|c| !c.is_whitespace())
                .collect();
            let Some(comma) = compact.find(',') else {
                return false;
            };
            let key = &compact[..comma];
            let value: String = compact[comma + 1..]
                .chars()
                .take_while(|c| c.is_alphanumeric() || *c == '_')
                .collect();
            let string_key =
                key == "String" || key == "&str" || (key.starts_with("&'") && key.ends_with("str"));
            string_key && INDEX_TYPES.contains(&value.as_str())
        })
    })
}

fn violations(path: &str, source: &str) -> Vec<Violation> {
    let code = code_only(source);
    let allowed = allowed_lines(path, &code).unwrap_or_default();
    let lines: Vec<&str> = code.lines().collect();
    let mut found = Vec::new();
    for (number, line) in lines.iter().enumerate() {
        let in_allowed = allowed
            .iter()
            .any(|&(from, to)| (from..=to).contains(&number));
        for rule in RULES {
            if line.contains(rule.pattern) && !(rule.allowlisted && in_allowed) {
                found.push(Violation {
                    path: path.to_owned(),
                    line: number + 1,
                    pattern: rule.pattern,
                    why: rule.why,
                });
            }
        }
        // A map type may wrap over a few lines; its name sits on the first.
        if !in_allowed {
            let rest = lines[number + 1..(number + 4).min(lines.len())].join(" ");
            if declares_bare_index_map(line, &rest) {
                found.push(Violation {
                    path: path.to_owned(),
                    line: number + 1,
                    pattern: BARE_MAP,
                    why: "a layer → bare texture index map: record `SlotHandle`s (`LayerSlotMap`)",
                });
            }
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

fn found(path: &str, source: &str) -> Vec<(usize, &'static str)> {
    violations(path, source)
        .into_iter()
        .map(|v| (v.line, v.pattern))
        .collect()
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
        "bare texture-index identity outside the residency allowlist:\n{}",
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
    service.remove_layer_by_atlas(index).unwrap();
    let drawn = service.find_layer_index_by_atlas(index);
    let patched = service.render_layer_index_for_atlas(index);
}
"#;
    assert_eq!(
        found("lib.rs", source),
        vec![
            (3, "layer_to_atlas_map"),
            (4, ".release_volume("),
            (5, ".release_layer_resources("),
            (6, ".slot_handle("),
            (7, "is_volume_slot_resident("),
            (8, "remove_layer_by_atlas("),
            (9, "find_layer_index_by_atlas("),
            (10, "render_layer_index_for_atlas("),
        ]
    );
    // The directory allowlist covers the residency APIs, never the old map.
    let allowed: Vec<_> = found("residency/release.rs", source)
        .into_iter()
        .map(|(_, pattern)| pattern)
        .collect();
    assert_eq!(allowed, vec!["layer_to_atlas_map"]);
}

#[test]
fn the_map_rule_catches_string_to_index_texture_maps_in_any_spelling() {
    let source = r#"
struct Owner {
    atlas: HashMap<String, u32>,
    slots:   HashMap< String ,u32 >,
    textures: BTreeMap<&'static str, usize>,
    by_slot: std::collections::HashMap<&str, u32>,
    texture_index: HashMap<
        String,
        u32,
    >,
    names: HashMap<String, u32>,
    slot_handles: HashMap<u32, SlotHandle>,
    slot_labels: HashMap<String, String>,
    slot_owner: HashMap<u32, String>, names_again: HashMap<String, u32>,
    texture_names: Vec<String>,
    ids: HashMap<String, u32>,
}
"#;
    assert_eq!(
        found("lib.rs", source),
        vec![
            (3, BARE_MAP),
            (4, BARE_MAP),
            (5, BARE_MAP),
            (6, BARE_MAP),
            (7, BARE_MAP),
        ],
        "names (no texture hint), index-keyed handle maps and string values pass"
    );
    assert!(found("residency/ring.rs", source).is_empty());
}

#[test]
fn the_gpu_upload_allowlist_covers_only_its_named_functions() {
    let source = r#"
pub(crate) fn upload_layer_volume(service: &mut RenderLoopService, index: u32) -> SlotHandle {
    service.slot_handle(index).unwrap()
}

pub(crate) fn editable_handle_at<'a>(service: &'a RenderLoopService, slot: SlotHandle) {
    service.editable_handle_for_volume("v", slot.index());
}

pub(crate) fn request(service: &mut RenderLoopService, index: u32) {
    service.release_volume(index).unwrap();
    let handle = service.slot_handle(index);
}
"#;
    assert_eq!(
        found("gpu_upload.rs", source),
        vec![(11, ".release_volume("), (12, ".slot_handle(")]
    );
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
    // Only the call after the test items: the stripping stops where they end.
    assert_eq!(found("lib.rs", source), vec![(30, ".release_volume(")]);
}

#[test]
fn a_test_only_field_or_variant_blanks_only_itself() {
    let source = r#"
struct Owner {
    #[cfg(test)]
    probe: HashMap<String, usize>,
    atlas: HashMap<String, u32>,
}
enum Event {
    #[cfg(test)]
    Probe(u32, u32),
    Released { slot: u32 },
}
fn after(service: &mut RenderLoopService, index: u32) {
    service.release_volume(index).unwrap();
}
#[cfg(test)]
fn helper() -> HashMap<String, u32> {
    service.release_volume(0).unwrap();
}
fn last(service: &mut RenderLoopService, index: u32) {
    service.slot_handle(index);
}
"#;
    assert_eq!(
        found("lib.rs", source),
        vec![
            (5, BARE_MAP),
            (13, ".release_volume("),
            (20, ".slot_handle(")
        ]
    );
}
