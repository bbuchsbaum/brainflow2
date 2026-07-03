//! Single source of truth for api-bridge Tauri command registration.
//!
//! The [`bridge_commands!`] macro is invoked exactly once — in `command_list.rs`,
//! which is `include!`d from `lib.rs` — and expands, at the crate root, to:
//!   * `COMMANDS: &[&str]` — every command name, consumed by the generated TS
//!     transport surface (`packages/api/src/generated/apiBridgeCommands.ts`) and by
//!     the permission checker (`tools/check_api_bridge_permissions.mjs`), and
//!   * `invoke_handler()` — the Tauri invoke handler wrapping `generate_handler!`.
//!
//! `build.rs` parses the same `command_list.rs` (via `command_list_parser.rs`) so
//! the plugin permission autogeneration stays in lockstep with the runtime handler;
//! the test below asserts the two views agree.

/// Expand a flat list of bare command identifiers into the api-bridge command
/// registry. See the module docs for the items this produces.
macro_rules! bridge_commands {
    ( $( $command:ident ),* $(,)? ) => {
        /// Every api-bridge command name, in registration order. Single source of
        /// truth shared by the Tauri invoke handler, the generated TypeScript
        /// transport surface, and the permission checker.
        pub const COMMANDS: &[&str] = &[ $( stringify!($command) ),* ];

        /// Tauri invoke handler covering every api-bridge command.
        pub(crate) fn invoke_handler<R: tauri::Runtime>(
        ) -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
            tauri::generate_handler![ $( $command ),* ]
        }
    };
}

pub(crate) use bridge_commands;

#[cfg(test)]
mod tests {
    include!("command_list_parser.rs");

    #[test]
    fn command_list_parses_to_registered_commands() {
        // `build.rs` view: parse the raw source text.
        let parsed = parse_command_list(include_str!("command_list.rs"));
        let parsed_set: std::collections::BTreeSet<&str> =
            parsed.iter().map(String::as_str).collect();

        // Macro view: the `COMMANDS` const the handler is generated from.
        let registered_set: std::collections::BTreeSet<&str> =
            crate::COMMANDS.iter().copied().collect();

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
}
