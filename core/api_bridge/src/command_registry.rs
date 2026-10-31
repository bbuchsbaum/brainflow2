//! Single source of truth for api-bridge Tauri command registration.
//!
//! The [`bridge_commands!`] macro is invoked exactly once — in `command_list.rs`,
//! which is `include!`d from `lib.rs` — and expands, at the crate root, to:
//!   * `COMMANDS: &[&str]` — every command name (core, then each module section),
//!     consumed by the generated TS transport surface
//!     (`packages/api/src/generated/apiBridgeCommands.ts`) and by the permission
//!     checker (`tools/check_api_bridge_permissions.mjs`),
//!   * `CORE_COMMANDS: &[&str]` — the `core { ... }` section,
//!   * `MODULE_COMMANDS: &[(&str, &[&str])]` — `(module id, commands)` per
//!     `module <id> { ... }` section, consumed by the generated
//!     `apiBridgeModules.ts`, and
//!   * `invoke_handler()` — the Tauri invoke handler wrapping `generate_handler!`.
//!     Core commands resolve at the crate root; module commands resolve as
//!     `modules::<id>::<cmd>`, so each must be defined in its adapter file.
//!
//! `build.rs` parses the same `command_list.rs` (via `command_list_parser.rs`) so
//! the plugin permission autogeneration — per command, plus one `module-<id>` set
//! per module — stays in lockstep with the runtime handler; the tests below assert
//! the two views agree.

/// Expand the sectioned command list into the api-bridge command registry. See
/// the module docs for the items this produces.
macro_rules! bridge_commands {
    (
        core { $( $core:ident ),* $(,)? }
        $( module $module:ident { $( $command:ident ),* $(,)? } )*
    ) => {
        /// Every api-bridge command name, in registration order. Single source of
        /// truth shared by the Tauri invoke handler, the generated TypeScript
        /// transport surface, and the permission checker.
        pub const COMMANDS: &[&str] = &[
            $( stringify!($core), )*
            $( $( stringify!($command), )* )*
        ];

        /// Commands in the `core { ... }` section of `command_list.rs`.
        pub const CORE_COMMANDS: &[&str] = &[ $( stringify!($core) ),* ];

        /// `(module id, commands)` for each `module <id> { ... }` section.
        pub const MODULE_COMMANDS: &[(&str, &[&str])] = &[
            $( (stringify!($module), &[ $( stringify!($command) ),* ]) ),*
        ];

        /// Tauri invoke handler covering every api-bridge command.
        pub(crate) fn invoke_handler<R: tauri::Runtime>(
        ) -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
            tauri::generate_handler![
                $( $core, )*
                $( $( modules::$module::$command, )* )*
            ]
        }
    };
}

pub(crate) use bridge_commands;

#[cfg(test)]
mod tests {
    include!("command_list_parser.rs");

    use std::collections::BTreeSet;

    /// Module commands that predate the `<module>_` prefix rule. The UI and the
    /// dev harness call them by name, so they keep their names. Do not add to this.
    const GRANDFATHERED_MODULE_COMMANDS: &[&str] = &[
        "list_analyses",
        "start_analysis",
        "cancel_analysis",
        "get_analysis_job_status",
    ];

    #[test]
    fn command_list_parses_to_registered_commands() {
        // `build.rs` view: parse the raw source text.
        let parsed = parse_command_list(include_str!("command_list.rs"));
        let parsed_set: BTreeSet<&str> = parsed.iter().map(String::as_str).collect();

        // Macro view: the `COMMANDS` const the handler is generated from.
        let registered_set: BTreeSet<&str> = crate::COMMANDS.iter().copied().collect();

        assert_eq!(
            parsed_set, registered_set,
            "build.rs parse of command_list.rs must match crate::COMMANDS (macro expansion)"
        );
        assert_eq!(
            parsed.len(),
            parsed_set.len(),
            "duplicate command identifier in command_list.rs"
        );
        assert_eq!(
            crate::COMMANDS.len(),
            registered_set.len(),
            "duplicate command name in COMMANDS"
        );
    }

    #[test]
    fn command_list_sections_match_macro_sections() {
        let sections =
            parse_command_sections(include_str!("command_list.rs")).expect("parse sections");
        let (core, modules) = sections.split_first().expect("core section");
        assert_eq!(core.module, None);
        assert_eq!(core.commands, crate::CORE_COMMANDS);

        let parsed_modules: Vec<(&str, Vec<&str>)> = modules
            .iter()
            .map(|section| {
                (
                    section.module.as_deref().expect("module section"),
                    section.commands.iter().map(String::as_str).collect(),
                )
            })
            .collect();
        let macro_modules: Vec<(&str, Vec<&str>)> = crate::MODULE_COMMANDS
            .iter()
            .map(|(id, commands)| (*id, commands.to_vec()))
            .collect();
        assert_eq!(parsed_modules, macro_modules);
    }

    #[test]
    fn new_module_commands_carry_the_module_prefix() {
        for (module, commands) in crate::MODULE_COMMANDS {
            for command in *commands {
                assert!(
                    command.starts_with(&format!("{module}_"))
                        || GRANDFATHERED_MODULE_COMMANDS.contains(command),
                    "module command `{command}` must be named `{module}_<name>`"
                );
            }
        }
    }

    #[test]
    fn parser_reads_core_and_module_sections() {
        let src = "
            // header comment with bridge_commands! { braces }
            bridge_commands! {
                core {
                    load_file, // trailing comment
                    // grouping comment
                    unload_volume,
                }

                module segmentation {
                    segmentation_create_session, segmentation_apply_stroke
                }
                module dti {}
            }
        ";
        let sections = parse_command_sections(src).expect("parse");
        assert_eq!(
            sections,
            vec![
                CommandSection {
                    module: None,
                    commands: vec!["load_file".into(), "unload_volume".into()],
                },
                CommandSection {
                    module: Some("segmentation".into()),
                    commands: vec![
                        "segmentation_create_session".into(),
                        "segmentation_apply_stroke".into(),
                    ],
                },
                CommandSection {
                    module: Some("dti".into()),
                    commands: vec![],
                },
            ]
        );
        assert_eq!(
            parse_command_list(src),
            vec![
                "load_file",
                "unload_volume",
                "segmentation_create_session",
                "segmentation_apply_stroke",
            ]
        );
    }

    #[test]
    fn parser_rejects_malformed_lists() {
        let cases = [
            ("bridge_commands! { load_file }", "expected `core {`"),
            (
                "bridge_commands! { module a { a_x } core { b } }",
                "expected `core {`",
            ),
            (
                "bridge_commands! { core { a } core { b } }",
                "expected `module <id> {`",
            ),
            (
                "bridge_commands! { core { a /* b */ } }",
                "unexpected character",
            ),
            ("bridge_commands! { core { a b } }", "expected `,` or `}`"),
            ("bridge_commands! { core { Load } }", "invalid command"),
            (
                "bridge_commands! { core { a } module m { m_a } module m { m_b } }",
                "duplicate module",
            ),
            ("bridge_commands! { core { a, a } }", "duplicate command"),
            ("bridge_commands! { core { a }", "unterminated"),
            ("no macro here", "missing `bridge_commands!`"),
        ];
        for (src, expected) in cases {
            let err = parse_command_sections(src).expect_err(src);
            assert!(err.contains(expected), "{src:?}: {err}");
        }
    }

    #[test]
    fn module_permission_set_lists_allow_ids() {
        let toml = module_permission_set_toml(
            "segmentation",
            &[
                "segmentation_create_session".into(),
                "segmentation_undo".into(),
            ],
        );
        assert!(
            toml.contains("identifier = \"module-segmentation\""),
            "{toml}"
        );
        assert!(toml.contains(
            "permissions = [\n  \"allow-segmentation-create-session\",\n  \"allow-segmentation-undo\",\n]"
        ), "{toml}");
        assert!(
            toml.contains("\"$schema\" = \"../../schemas/schema.json\""),
            "{toml}"
        );
        assert_eq!(
            module_permission_set_identifier("dti_fit"),
            "module-dti-fit"
        );
    }
}
