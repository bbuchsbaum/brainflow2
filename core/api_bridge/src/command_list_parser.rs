// Shared parser for `command_list.rs`.
//
// This file is `include!`d by both `build.rs` (so the Tauri plugin permission
// autogeneration derives its command names from the same source the runtime
// handler uses) and by the sync test in `command_registry.rs` (so the two views
// are asserted equal). Keep it dependency-free so it can compile inside a build
// script.

/// Extract the bare command identifiers from the `bridge_commands! { ... }`
/// invocation in `command_list.rs`. Line comments (`// ...`) are ignored, so the
/// grouping comments in that file do not affect the result.
fn parse_command_list(src: &str) -> Vec<String> {
    // Anchor on the macro invocation so a brace in the doc-comment header cannot be
    // mistaken for the body opener.
    let anchor = src.find("bridge_commands!").unwrap_or(0);
    let body_start = src[anchor..].find('{').map(|i| anchor + i + 1).unwrap_or(0);
    let body_end = src.rfind('}').unwrap_or(src.len());
    let body = if body_start <= body_end {
        &src[body_start..body_end]
    } else {
        ""
    };

    let mut names = Vec::new();
    for raw_line in body.lines() {
        // Strip a trailing line comment.
        let line = match raw_line.find("//") {
            Some(i) => &raw_line[..i],
            None => raw_line,
        };
        for token in line.split(',') {
            let token = token.trim();
            if token.is_empty() {
                continue;
            }
            let mut chars = token.chars();
            let first_ok = chars
                .next()
                .map(|c| c.is_ascii_lowercase() || c == '_')
                .unwrap_or(false);
            let rest_ok = token
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
            if first_ok && rest_ok {
                names.push(token.to_string());
            }
        }
    }
    names
}
