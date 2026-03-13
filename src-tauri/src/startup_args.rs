use std::ffi::{OsStr, OsString};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

pub const SUPPORTED_WORKSPACE_TYPES: &[&str] = &[
    "orthogonal-locked",
    "orthogonal-flexible",
    "mosaic",
    "lightbox",
    "set-studio",
    "roi-stats",
    "coordinate-converter",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StartupAction {
    Mount { path: String },
    RemoteMount { spec: StartupRemoteMountSpec },
    OpenFile { path: String },
    Workspace { workspace_type: String },
    Template { template_id: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StartupRemoteMountSpec {
    Profile {
        profile: String,
    },
    Direct {
        user: String,
        host: String,
        remote_path: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EarlyExit {
    Help,
    Version,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct ParsedStartupArgs {
    pub actions: Vec<StartupAction>,
    pub warnings: Vec<String>,
    pub early_exit: Option<EarlyExit>,
}

#[derive(Default)]
pub struct StartupActionQueue {
    pending: Mutex<Vec<StartupAction>>,
}

impl StartupActionQueue {
    pub fn new(actions: Vec<StartupAction>) -> Self {
        Self {
            pending: Mutex::new(actions),
        }
    }

    pub fn drain(&self) -> Vec<StartupAction> {
        match self.pending.lock() {
            Ok(mut pending) => std::mem::take(&mut *pending),
            Err(poisoned) => {
                let mut pending = poisoned.into_inner();
                std::mem::take(&mut *pending)
            }
        }
    }
}

pub fn format_cli_help(program_name: &str) -> String {
    format!(
        concat!(
            "Usage: {program_name} [OPTIONS] [FILES...]\n\n",
            "Startup options:\n",
            "  -h, --help                 Show this help and exit\n",
            "  -V, --version              Show the app version and exit\n",
            "  -m, --mount <PATH>         Mount a directory at startup (repeatable)\n",
            "      --mount=<PATH>         Same as above\n",
            "                             Remote forms: profile:NAME or user@host:/path\n",
            "  -o, --open <PATH>          Open a file or surface at startup (repeatable)\n",
            "      --open=<PATH>          Same as above\n",
            "  -w, --workspace <TYPE>     Create a workspace at startup\n",
            "      --workspace=<TYPE>     Same as above\n",
            "  -t, --template <ID>        Load a registered volume template at startup\n",
            "      --template=<ID>        Same as above\n",
            "  --                         Treat remaining arguments as file paths\n\n",
            "Positional arguments:\n",
            "  FILES...                   Files/surfaces to open at startup\n\n",
            "Supported workspace types:\n",
            "  {workspace_types}\n\n",
            "Examples:\n",
            "  {program_name} --mount . brain.nii.gz lh.pial.gii\n",
            "  {program_name} --mount brad@trillium.alliance.can.ca:/scratch/brad\n",
            "  {program_name} --mount profile:trillium\n",
            "  {program_name} --workspace orthogonal-flexible --open sub-01_bold.nii.gz\n",
            "  {program_name} --template MNI152NLin2009cAsym_T1w_1mm\n"
        ),
        program_name = program_name,
        workspace_types = SUPPORTED_WORKSPACE_TYPES.join(", "),
    )
}

pub fn parse_startup_args<I, S>(args: I, cwd: &Path) -> ParsedStartupArgs
where
    I: IntoIterator<Item = S>,
    S: Into<OsString>,
{
    let mut parsed = ParsedStartupArgs::default();
    let mut positional_only = false;
    let mut iter = args.into_iter().map(Into::into).peekable();

    while let Some(arg) = iter.next() {
        if arg == OsStr::new("-h") || arg == OsStr::new("--help") {
            parsed.early_exit = Some(EarlyExit::Help);
            break;
        }

        if arg == OsStr::new("-V") || arg == OsStr::new("--version") {
            parsed.early_exit = Some(EarlyExit::Version);
            break;
        }

        if positional_only {
            push_open_file(&mut parsed, arg, cwd);
            continue;
        }

        if arg == OsStr::new("--") {
            positional_only = true;
            continue;
        }

        if arg == OsStr::new("-m") {
            match iter.next() {
                Some(path) => push_mount(&mut parsed, path, cwd),
                None => parsed
                    .warnings
                    .push("Ignoring '-m' without a following path".to_string()),
            }
            continue;
        }

        if arg == OsStr::new("--mount") {
            match iter.next() {
                Some(path) => push_mount(&mut parsed, path, cwd),
                None => parsed
                    .warnings
                    .push("Ignoring '--mount' without a following path".to_string()),
            }
            continue;
        }

        if let Some(value) = arg
            .to_string_lossy()
            .strip_prefix("--mount=")
            .map(str::to_string)
        {
            push_mount(&mut parsed, OsString::from(value), cwd);
            continue;
        }

        if arg == OsStr::new("-o") {
            match iter.next() {
                Some(path) => push_open_file(&mut parsed, path, cwd),
                None => parsed
                    .warnings
                    .push("Ignoring '-o' without a following path".to_string()),
            }
            continue;
        }

        if arg == OsStr::new("--open") {
            match iter.next() {
                Some(path) => push_open_file(&mut parsed, path, cwd),
                None => parsed
                    .warnings
                    .push("Ignoring '--open' without a following path".to_string()),
            }
            continue;
        }

        if let Some(value) = arg
            .to_string_lossy()
            .strip_prefix("--open=")
            .map(str::to_string)
        {
            push_open_file(&mut parsed, OsString::from(value), cwd);
            continue;
        }

        if arg == OsStr::new("-w") {
            match iter.next() {
                Some(workspace_type) => push_workspace(&mut parsed, workspace_type),
                None => parsed
                    .warnings
                    .push("Ignoring '-w' without a following workspace type".to_string()),
            }
            continue;
        }

        if arg == OsStr::new("--workspace") {
            match iter.next() {
                Some(workspace_type) => push_workspace(&mut parsed, workspace_type),
                None => parsed
                    .warnings
                    .push("Ignoring '--workspace' without a following workspace type".to_string()),
            }
            continue;
        }

        if let Some(value) = arg
            .to_string_lossy()
            .strip_prefix("--workspace=")
            .map(str::to_string)
        {
            push_workspace(&mut parsed, OsString::from(value));
            continue;
        }

        if arg == OsStr::new("-t") {
            match iter.next() {
                Some(template_id) => push_template(&mut parsed, template_id),
                None => parsed
                    .warnings
                    .push("Ignoring '-t' without a following template ID".to_string()),
            }
            continue;
        }

        if arg == OsStr::new("--template") {
            match iter.next() {
                Some(template_id) => push_template(&mut parsed, template_id),
                None => parsed
                    .warnings
                    .push("Ignoring '--template' without a following template ID".to_string()),
            }
            continue;
        }

        if let Some(value) = arg
            .to_string_lossy()
            .strip_prefix("--template=")
            .map(str::to_string)
        {
            push_template(&mut parsed, OsString::from(value));
            continue;
        }

        if arg.to_string_lossy().starts_with('-') {
            parsed.warnings.push(format!(
                "Ignoring unsupported startup option '{}'",
                arg.to_string_lossy()
            ));
            continue;
        }

        push_open_file(&mut parsed, arg, cwd);
    }

    parsed
}

fn push_mount(parsed: &mut ParsedStartupArgs, raw_path: OsString, cwd: &Path) {
    if let Some(spec) = parse_remote_mount_spec(&raw_path) {
        parsed.actions.push(StartupAction::RemoteMount { spec });
        return;
    }

    match resolve_cli_path(raw_path, cwd) {
        Some(path) => parsed.actions.push(StartupAction::Mount { path }),
        None => parsed
            .warnings
            .push("Ignoring empty mount path passed on the command line".to_string()),
    }
}

fn push_open_file(parsed: &mut ParsedStartupArgs, raw_path: OsString, cwd: &Path) {
    match resolve_cli_path(raw_path, cwd) {
        Some(path) => parsed.actions.push(StartupAction::OpenFile { path }),
        None => parsed
            .warnings
            .push("Ignoring empty file path passed on the command line".to_string()),
    }
}

fn push_workspace(parsed: &mut ParsedStartupArgs, raw_workspace: OsString) {
    let raw = raw_workspace.to_string_lossy().trim().to_string();
    if raw.is_empty() {
        parsed
            .warnings
            .push("Ignoring empty workspace type passed on the command line".to_string());
        return;
    }

    match normalize_workspace_type(&raw) {
        Some(workspace_type) => parsed
            .actions
            .push(StartupAction::Workspace { workspace_type }),
        None => parsed.warnings.push(format!(
            "Ignoring unsupported workspace type '{}'. Expected one of: {}",
            raw,
            SUPPORTED_WORKSPACE_TYPES.join(", ")
        )),
    }
}

fn push_template(parsed: &mut ParsedStartupArgs, raw_template_id: OsString) {
    let template_id = raw_template_id.to_string_lossy().trim().to_string();
    if template_id.is_empty() {
        parsed
            .warnings
            .push("Ignoring empty template ID passed on the command line".to_string());
        return;
    }

    parsed.actions.push(StartupAction::Template { template_id });
}

fn resolve_cli_path(raw_path: OsString, cwd: &Path) -> Option<String> {
    if raw_path.is_empty() {
        return None;
    }

    let path = PathBuf::from(raw_path);
    let candidate = if path.is_absolute() {
        path
    } else {
        cwd.join(path)
    };
    let normalized = candidate
        .canonicalize()
        .unwrap_or_else(|_| normalize_path(&candidate));
    Some(normalized.to_string_lossy().into_owned())
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }

    normalized
}

fn normalize_workspace_type(raw: &str) -> Option<String> {
    let trimmed = raw.trim().to_ascii_lowercase();
    let canonical = match trimmed.as_str() {
        "orthogonal" | "orthogonal-locked" | "ortho" | "locked" => "orthogonal-locked",
        "orthogonal-panels" | "orthogonal-flexible" | "panels" | "flexible" => {
            "orthogonal-flexible"
        }
        "mosaic" => "mosaic",
        "lightbox" => "lightbox",
        "set-studio" | "setstudio" => "set-studio",
        "roi-stats" | "roistats" => "roi-stats",
        "coordinate-converter" | "coord" | "coords" => "coordinate-converter",
        _ => return None,
    };

    Some(canonical.to_string())
}

fn parse_remote_mount_spec(raw: &OsString) -> Option<StartupRemoteMountSpec> {
    let value = raw.to_string_lossy().trim().to_string();
    if value.is_empty() {
        return None;
    }

    if let Some(profile) = value.strip_prefix("profile:") {
        let profile = profile.trim();
        if profile.is_empty() {
            return None;
        }
        return Some(StartupRemoteMountSpec::Profile {
            profile: profile.to_string(),
        });
    }

    let at_index = value.find('@')?;
    let host_path = &value[at_index + 1..];
    let separator_index = host_path.find(":/")?;
    let user = value[..at_index].trim();
    let host = host_path[..separator_index].trim();
    let remote_path = &host_path[separator_index + 1..];

    if user.is_empty() || host.is_empty() || remote_path.is_empty() {
        return None;
    }

    Some(StartupRemoteMountSpec::Direct {
        user: user.to_string(),
        host: host.to_string(),
        remote_path: remote_path.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        format_cli_help, parse_startup_args, EarlyExit, StartupAction, StartupActionQueue,
        StartupRemoteMountSpec,
    };
    use std::path::PathBuf;

    fn cwd() -> PathBuf {
        PathBuf::from("/tmp/brainflow-cli-tests")
    }

    #[test]
    fn parses_mounts_and_files_in_order() {
        let parsed = parse_startup_args(
            vec![
                "--mount",
                ".",
                "data/brain.nii.gz",
                "--mount=surfaces",
                "/absolute/mesh.gii",
            ],
            &cwd(),
        );

        assert!(parsed.warnings.is_empty());
        assert_eq!(
            parsed.actions,
            vec![
                StartupAction::Mount {
                    path: "/tmp/brainflow-cli-tests".to_string(),
                },
                StartupAction::OpenFile {
                    path: "/tmp/brainflow-cli-tests/data/brain.nii.gz".to_string(),
                },
                StartupAction::Mount {
                    path: "/tmp/brainflow-cli-tests/surfaces".to_string(),
                },
                StartupAction::OpenFile {
                    path: "/absolute/mesh.gii".to_string(),
                },
            ]
        );
    }

    #[test]
    fn parses_remote_mount_forms() {
        let parsed = parse_startup_args(
            vec![
                "--mount",
                "profile:trillium",
                "--mount=brad@trillium.alliance.can.ca:/scratch/brad",
            ],
            &cwd(),
        );

        assert!(parsed.warnings.is_empty());
        assert_eq!(
            parsed.actions,
            vec![
                StartupAction::RemoteMount {
                    spec: StartupRemoteMountSpec::Profile {
                        profile: "trillium".to_string(),
                    },
                },
                StartupAction::RemoteMount {
                    spec: StartupRemoteMountSpec::Direct {
                        user: "brad".to_string(),
                        host: "trillium.alliance.can.ca".to_string(),
                        remote_path: "/scratch/brad".to_string(),
                    },
                },
            ]
        );
    }

    #[test]
    fn parses_explicit_open_workspace_and_template_flags() {
        let parsed = parse_startup_args(
            vec![
                "-o",
                "bold.nii.gz",
                "--workspace",
                "panels",
                "--template=MNI152NLin2009cAsym_T1w_1mm",
            ],
            &cwd(),
        );

        assert!(parsed.warnings.is_empty());
        assert_eq!(
            parsed.actions,
            vec![
                StartupAction::OpenFile {
                    path: "/tmp/brainflow-cli-tests/bold.nii.gz".to_string(),
                },
                StartupAction::Workspace {
                    workspace_type: "orthogonal-flexible".to_string(),
                },
                StartupAction::Template {
                    template_id: "MNI152NLin2009cAsym_T1w_1mm".to_string(),
                },
            ]
        );
    }

    #[test]
    fn stops_option_parsing_after_double_dash_and_warns_on_unknown_flags() {
        let parsed = parse_startup_args(
            vec!["--unknown", "--", "--not-an-option.nii.gz", "-w", "mosaic"],
            &cwd(),
        );

        assert_eq!(
            parsed.warnings,
            vec!["Ignoring unsupported startup option '--unknown'".to_string()]
        );
        assert_eq!(
            parsed.actions,
            vec![
                StartupAction::OpenFile {
                    path: "/tmp/brainflow-cli-tests/--not-an-option.nii.gz".to_string(),
                },
                StartupAction::OpenFile {
                    path: "/tmp/brainflow-cli-tests/-w".to_string(),
                },
                StartupAction::OpenFile {
                    path: "/tmp/brainflow-cli-tests/mosaic".to_string(),
                },
            ]
        );
    }

    #[test]
    fn validates_workspace_types_and_supports_help_and_version() {
        let invalid_workspace = parse_startup_args(vec!["--workspace", "wat"], &cwd());
        assert_eq!(
            invalid_workspace.warnings,
            vec![
                "Ignoring unsupported workspace type 'wat'. Expected one of: orthogonal-locked, orthogonal-flexible, mosaic, lightbox, set-studio, roi-stats, coordinate-converter".to_string()
            ]
        );
        assert!(invalid_workspace.actions.is_empty());

        let help = parse_startup_args(vec!["--help", "ignored.nii.gz"], &cwd());
        assert_eq!(help.early_exit, Some(EarlyExit::Help));
        assert!(help.actions.is_empty());

        let version = parse_startup_args(vec!["-V", "ignored.nii.gz"], &cwd());
        assert_eq!(version.early_exit, Some(EarlyExit::Version));
        assert!(version.actions.is_empty());
    }

    #[test]
    fn formats_help_text_with_examples() {
        let help = format_cli_help("brainflow");
        assert!(help.contains("Usage: brainflow [OPTIONS] [FILES...]"));
        assert!(help.contains("--workspace <TYPE>"));
        assert!(help.contains("orthogonal-flexible"));
        assert!(help.contains("profile:trillium"));
    }

    #[test]
    fn drains_startup_queue_once() {
        let queue = StartupActionQueue::new(vec![
            StartupAction::Mount {
                path: "/tmp/one".to_string(),
            },
            StartupAction::OpenFile {
                path: "/tmp/two.nii.gz".to_string(),
            },
        ]);

        assert_eq!(queue.drain().len(), 2);
        assert!(queue.drain().is_empty());
    }
}
