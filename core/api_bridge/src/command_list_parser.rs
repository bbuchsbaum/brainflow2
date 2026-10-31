// Shared parser for `command_list.rs`.
//
// This file is `include!`d by both `build.rs` (so the Tauri plugin permission
// autogeneration derives its command names and per-module permission sets from
// the same source the runtime handler uses) and by the tests in
// `command_registry.rs` (so the two views are asserted equal). Keep it
// dependency-free so it can compile inside a build script.

/// One section of the `bridge_commands!` list: `core { ... }` (`module == None`)
/// or `module <id> { ... }`.
#[derive(Debug, Clone, PartialEq, Eq)]
struct CommandSection {
    module: Option<String>,
    commands: Vec<String>,
}

/// Parse the `bridge_commands! { core { ... } module <id> { ... } ... }`
/// invocation in `command_list.rs`. Line comments (`// ...`) are ignored; any
/// other punctuation (including `/* */` block comments) is an error, so the
/// grammar matches what the `bridge_commands!` macro accepts.
fn parse_command_sections(src: &str) -> Result<Vec<CommandSection>, String> {
    const ANCHOR: &str = "bridge_commands!";

    // Anchor on the macro invocation outside comments, so the doc-comment header
    // in `command_list.rs` cannot be mistaken for the body.
    let mut body = None;
    let mut offset = 0;
    for line in src.split_inclusive('\n') {
        let code = line.split("//").next().unwrap_or("");
        if let Some(i) = code.find(ANCHOR) {
            body = Some(&src[offset + i + ANCHOR.len()..]);
            break;
        }
        offset += line.len();
    }
    let body = body.ok_or("missing `bridge_commands!` invocation")?;

    let mut tokens: Vec<String> = Vec::new();
    for raw_line in body.lines() {
        let line = raw_line.split("//").next().unwrap_or("");
        let mut word = String::new();
        for c in line.chars() {
            if c.is_ascii_alphanumeric() || c == '_' {
                word.push(c);
                continue;
            }
            if !word.is_empty() {
                tokens.push(std::mem::take(&mut word));
            }
            match c {
                '{' | '}' | ',' => tokens.push(c.to_string()),
                c if c.is_whitespace() => {}
                other => {
                    return Err(format!("unexpected character `{other}` in the command list"))
                }
            }
        }
        if !word.is_empty() {
            tokens.push(word);
        }
    }

    fn is_identifier(token: &str) -> bool {
        let mut chars = token.chars();
        chars
            .next()
            .map(|c| c.is_ascii_lowercase() || c == '_')
            .unwrap_or(false)
            && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
    }

    let mut tokens = tokens.into_iter();
    let mut next = |what: &str| -> Result<String, String> {
        tokens
            .next()
            .ok_or_else(|| format!("unterminated command list: expected {what}"))
    };

    if next("`{`")? != "{" {
        return Err("expected `{` after `bridge_commands!`".to_string());
    }

    let mut sections: Vec<CommandSection> = Vec::new();
    let mut seen_commands = std::collections::BTreeSet::new();
    loop {
        let head = next("a section or `}`")?;
        let module = match head.as_str() {
            "}" => break,
            "core" if sections.is_empty() => None,
            "module" if !sections.is_empty() => {
                let id = next("a module id")?;
                if !is_identifier(&id) || id.starts_with('_') {
                    return Err(format!("invalid module id `{id}`"));
                }
                if sections.iter().any(|s| s.module.as_deref() == Some(id.as_str())) {
                    return Err(format!("duplicate module section `{id}`"));
                }
                Some(id)
            }
            other if sections.is_empty() => {
                return Err(format!("expected `core {{` as the first section, found `{other}`"))
            }
            other => return Err(format!("expected `module <id> {{`, found `{other}`")),
        };
        if next("`{`")? != "{" {
            return Err("expected `{` to open a section".to_string());
        }

        let mut commands = Vec::new();
        loop {
            let token = next("a command or `}`")?;
            if token == "}" {
                break;
            }
            if !is_identifier(&token) {
                return Err(format!("invalid command identifier `{token}`"));
            }
            if !seen_commands.insert(token.clone()) {
                return Err(format!("duplicate command `{token}`"));
            }
            commands.push(token);
            match next("`,` or `}`")?.as_str() {
                "," => {}
                "}" => break,
                other => return Err(format!("expected `,` or `}}` after a command, found `{other}`")),
            }
        }
        sections.push(CommandSection { module, commands });
    }

    if sections.is_empty() {
        return Err("expected `core {` as the first section".to_string());
    }
    Ok(sections)
}

/// Every command name in `command_list.rs`, in section order. Panics on a
/// malformed list (the build script and tests want a hard failure).
#[allow(dead_code)]
fn parse_command_list(src: &str) -> Vec<String> {
    parse_command_sections(src)
        .unwrap_or_else(|err| panic!("malformed src/command_list.rs: {err}"))
        .into_iter()
        .flat_map(|section| section.commands)
        .collect()
}

/// Identifier of the permission set that grants every command of `module`.
#[allow(dead_code)]
fn module_permission_set_identifier(module: &str) -> String {
    format!("module-{}", module.replace('_', "-"))
}

/// Contents of `permissions/autogenerated/modules/<module>.toml`: one Tauri
/// permission set over the module's autogenerated `allow-*` permissions.
#[allow(dead_code)]
fn module_permission_set_toml(module: &str, commands: &[String]) -> String {
    let mut toml = format!(
        "# Automatically generated from the `module {module}` section of \
         src/command_list.rs by build.rs - DO NOT EDIT!\n\n\
         \"$schema\" = \"../../schemas/schema.json\"\n\n\
         [[set]]\n\
         identifier = \"{}\"\n\
         description = \"Enables every command of the {module} module.\"\n\
         permissions = [\n",
        module_permission_set_identifier(module)
    );
    for command in commands {
        toml.push_str(&format!("  \"allow-{}\",\n", command.replace('_', "-")));
    }
    toml.push_str("]\n");
    toml
}
