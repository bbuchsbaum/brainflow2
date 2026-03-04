//! Analysis plugin infrastructure.
//!
//! This module provides a lightweight host-side registry and job manager for
//! running analyses in Brainflow. Analyses are discovered as either:
//! - **Built-in runners** (compiled into the app), or
//! - **Sidecar runners** (external executables invoked via a CLI+JSON protocol).
//!
//! The viewer core stays unaware of any analysis logic. Instead, analyses
//! declare inputs/params/outputs with [`bridge_types::AnalysisDescriptor`],
//! and completed outputs are registered as normal artifacts (volumes, surfaces,
//! tables, files) by the host.

use bridge_types::{
    AnalysisArtifact, AnalysisArtifactKind, AnalysisDescriptor, AnalysisInput, AnalysisJobState,
    AnalysisJobStatus, AnalysisRunnerKind, AnalysisStartRequest, BridgeError, BridgeResult,
};
use log::{debug, error, info, warn};
use serde::Deserialize;
use serde_json::Value as JsonValue;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use uuid::Uuid;

const ANALYSIS_API_VERSION: &str = "0.1";

/// Internal runner configuration.
#[derive(Debug, Clone)]
pub enum AnalysisRunner {
    Builtin,
    Sidecar(SidecarSpec),
}

#[derive(Debug, Clone)]
pub struct SidecarSpec {
    pub command: PathBuf,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub working_dir: Option<PathBuf>,
    pub timeout_sec: Option<u64>,
}

#[derive(Debug, Clone)]
pub struct AnalysisDefinition {
    pub descriptor: AnalysisDescriptor,
    pub runner: AnalysisRunner,
}

/// Registry for all known analyses.
#[derive(Default)]
pub struct AnalysisRegistry {
    analyses: HashMap<String, AnalysisDefinition>,
}

impl AnalysisRegistry {
    pub fn new() -> Self {
        Self {
            analyses: HashMap::new(),
        }
    }

    pub fn list(&self) -> Vec<AnalysisDescriptor> {
        self.analyses
            .values()
            .map(|d| d.descriptor.clone())
            .collect()
    }

    pub fn get(&self, id: &str) -> Option<AnalysisDefinition> {
        self.analyses.get(id).cloned()
    }

    pub fn register(&mut self, def: AnalysisDefinition) {
        self.analyses.insert(def.descriptor.id.clone(), def);
    }

    /// Attempt to load sidecar analyses from the default plugin locations.
    /// Failures are logged but non-fatal.
    pub fn load_default_locations(&mut self) {
        // App-bundled plugins under workspace `plugins/analyses/*`.
        self.load_from_dir(Path::new("plugins/analyses"));

        // User plugins under platform-specific data dir.
        if let Some(proj_dirs) = directories::ProjectDirs::from("", "", "brainflow") {
            let user_dir = proj_dirs.data_local_dir().join("plugins/analyses");
            self.load_from_dir(&user_dir);
        }
    }

    /// Load all sidecar analyses from a directory of plugin folders.
    ///
    /// Each plugin folder should contain an `analysis.json` manifest.
    pub fn load_from_dir(&mut self, root: &Path) {
        if !root.exists() {
            return;
        }

        let entries = match fs::read_dir(root) {
            Ok(e) => e,
            Err(err) => {
                warn!(
                    "Failed to read analysis plugins dir {}: {}",
                    root.display(),
                    err
                );
                return;
            }
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let manifest_path = path.join("analysis.json");
            if !manifest_path.exists() {
                continue;
            }

            match load_manifest(&manifest_path, &path) {
                Ok(def) => {
                    info!("Loaded analysis plugin '{}'", def.descriptor.id);
                    self.register(def);
                }
                Err(err) => {
                    warn!(
                        "Failed to load analysis manifest {}: {:?}",
                        manifest_path.display(),
                        err
                    );
                }
            }
        }
    }
}

#[derive(Debug, Deserialize)]
struct AnalysisManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub api_version: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub inputs: Vec<bridge_types::AnalysisInputKind>,
    #[serde(default)]
    pub outputs: Vec<AnalysisArtifactKind>,
    #[serde(default)]
    pub params_schema: JsonValue,
    pub runner: RunnerManifest,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum RunnerManifest {
    Builtin,
    Sidecar {
        command: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        env: HashMap<String, String>,
        #[serde(default)]
        timeout_sec: Option<u64>,
    },
}

fn load_manifest(path: &Path, plugin_dir: &Path) -> BridgeResult<AnalysisDefinition> {
    let text = fs::read_to_string(path).map_err(|e| BridgeError::Io {
        code: 11001,
        details: e.to_string(),
    })?;

    let manifest: AnalysisManifest =
        serde_json::from_str(&text).map_err(|e| BridgeError::Input {
            code: 11002,
            details: format!("Invalid analysis manifest: {}", e),
        })?;

    let api_version = manifest
        .api_version
        .unwrap_or_else(|| ANALYSIS_API_VERSION.to_string());

    let descriptor = AnalysisDescriptor {
        id: manifest.id.clone(),
        name: manifest.name.clone(),
        version: manifest.version.clone(),
        api_version,
        description: manifest.description.clone(),
        inputs: manifest.inputs.clone(),
        params_schema: manifest.params_schema.clone(),
        outputs: manifest.outputs.clone(),
        runner: match manifest.runner {
            RunnerManifest::Builtin => AnalysisRunnerKind::Builtin,
            RunnerManifest::Sidecar { .. } => AnalysisRunnerKind::Sidecar,
        },
    };

    let runner = match manifest.runner {
        RunnerManifest::Builtin => AnalysisRunner::Builtin,
        RunnerManifest::Sidecar {
            command,
            args,
            env,
            timeout_sec,
        } => {
            let cmd_path = {
                let p = PathBuf::from(command);
                if p.is_absolute() {
                    p
                } else {
                    plugin_dir.join(p)
                }
            };
            AnalysisRunner::Sidecar(SidecarSpec {
                command: cmd_path,
                args,
                env,
                working_dir: Some(plugin_dir.to_path_buf()),
                timeout_sec,
            })
        }
    };

    Ok(AnalysisDefinition { descriptor, runner })
}

/// Manager for currently running analysis jobs.
#[derive(Default)]
pub struct AnalysisJobManager {
    jobs: HashMap<String, AnalysisJobEntry>,
}

struct AnalysisJobEntry {
    status: Arc<Mutex<AnalysisJobStatus>>,
    handle: JoinHandle<()>,
}

impl AnalysisJobManager {
    pub fn new() -> Self {
        Self {
            jobs: HashMap::new(),
        }
    }

    pub fn insert(
        &mut self,
        job_id: String,
        status: Arc<Mutex<AnalysisJobStatus>>,
        handle: JoinHandle<()>,
    ) {
        self.jobs
            .insert(job_id, AnalysisJobEntry { status, handle });
    }

    pub fn status_arc(&self, job_id: &str) -> Option<Arc<Mutex<AnalysisJobStatus>>> {
        self.jobs.get(job_id).map(|e| Arc::clone(&e.status))
    }

    pub async fn get_status(&self, job_id: &str) -> Option<AnalysisJobStatus> {
        let arc = self.status_arc(job_id)?;
        let snapshot = arc.lock().await.clone();
        Some(snapshot)
    }

    pub async fn cancel(&mut self, job_id: &str) -> bool {
        let Some(entry) = self.jobs.get(job_id) else {
            return false;
        };

        {
            let mut status = entry.status.lock().await;
            status.state = AnalysisJobState::Cancelled;
            status.finished_at_ms = Some(current_time_ms());
            status.message = Some("Cancelled by user".to_string());
        }

        entry.handle.abort();
        true
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum SidecarEvent {
    Progress {
        #[allow(dead_code)]
        job_id: String,
        pct: Option<f32>,
        message: Option<String>,
    },
    Log {
        #[allow(dead_code)]
        job_id: String,
        level: Option<String>,
        message: String,
    },
    Artifact {
        #[allow(dead_code)]
        job_id: String,
        artifact: AnalysisArtifact,
    },
    Result {
        #[allow(dead_code)]
        job_id: String,
        artifacts: Vec<AnalysisArtifact>,
    },
    Error {
        #[allow(dead_code)]
        job_id: String,
        message: String,
    },
}

#[derive(Debug, serde::Serialize)]
struct SidecarRunRequest {
    api_version: String,
    job_id: String,
    inputs: Vec<AnalysisInput>,
    params: JsonValue,
    output_dir: String,
    temp_dir: String,
}

fn current_time_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Start an analysis job and return its job id.
pub async fn start_analysis_job(
    registry: Arc<Mutex<AnalysisRegistry>>,
    jobs: Arc<Mutex<AnalysisJobManager>>,
    request: AnalysisStartRequest,
) -> BridgeResult<String> {
    let definition = {
        let reg = registry.lock().await;
        reg.get(&request.analysis_id).ok_or(BridgeError::Input {
            code: 11010,
            details: format!("Unknown analysis id '{}'", request.analysis_id),
        })?
    };

    let job_id = Uuid::new_v4().to_string();
    let output_dir = std::env::temp_dir()
        .join("brainflow_jobs")
        .join(&job_id)
        .join("out");
    let temp_dir = std::env::temp_dir()
        .join("brainflow_jobs")
        .join(&job_id)
        .join("tmp");

    fs::create_dir_all(&output_dir).map_err(|e| BridgeError::Io {
        code: 11011,
        details: e.to_string(),
    })?;
    fs::create_dir_all(&temp_dir).map_err(|e| BridgeError::Io {
        code: 11012,
        details: e.to_string(),
    })?;

    let status = AnalysisJobStatus {
        job_id: job_id.clone(),
        analysis_id: request.analysis_id.clone(),
        state: AnalysisJobState::Queued,
        started_at_ms: Some(current_time_ms()),
        finished_at_ms: None,
        progress: None,
        message: Some("Queued".to_string()),
        artifacts: None,
        error: None,
    };
    let status_arc = Arc::new(Mutex::new(status));

    let status_arc_clone = Arc::clone(&status_arc);

    let runner = definition.runner.clone();
    let definition_descriptor = definition.descriptor.clone();
    let req_clone = request.clone();
    let job_id_for_runner = job_id.clone();
    let output_dir_str = output_dir.to_string_lossy().to_string();
    let temp_dir_str = temp_dir.to_string_lossy().to_string();

    let handle: JoinHandle<()> = tokio::spawn(async move {
        {
            let mut st = status_arc_clone.lock().await;
            st.state = AnalysisJobState::Running;
            st.message = Some("Running".to_string());
        }

        let result = match runner {
            AnalysisRunner::Builtin => Err(BridgeError::Internal {
                code: 11020,
                details: "Builtin analyses not yet implemented".to_string(),
            }),
            AnalysisRunner::Sidecar(spec) => {
                run_sidecar(
                    &spec,
                    &definition_descriptor,
                    req_clone,
                    &job_id_for_runner,
                    &output_dir_str,
                    &temp_dir_str,
                    Arc::clone(&status_arc_clone),
                )
                .await
            }
        };

        match result {
            Ok(artifacts) => {
                let mut st = status_arc_clone.lock().await;
                st.state = AnalysisJobState::Completed;
                st.finished_at_ms = Some(current_time_ms());
                st.progress = Some(1.0);
                st.message = Some("Completed".to_string());
                st.artifacts = Some(artifacts.clone());
            }
            Err(err) => {
                let mut st = status_arc_clone.lock().await;
                if st.state != AnalysisJobState::Cancelled {
                    st.state = AnalysisJobState::Failed;
                    st.finished_at_ms = Some(current_time_ms());
                    st.error = Some(err.to_string());
                    st.message = Some("Failed".to_string());
                }
            }
        }
    });

    {
        let mut jobs_guard = jobs.lock().await;
        jobs_guard.insert(job_id.clone(), Arc::clone(&status_arc), handle);
    }

    Ok(job_id)
}

async fn run_sidecar(
    spec: &SidecarSpec,
    descriptor: &AnalysisDescriptor,
    request: AnalysisStartRequest,
    job_id: &str,
    output_dir: &str,
    temp_dir: &str,
    status_arc: Arc<Mutex<AnalysisJobStatus>>,
) -> BridgeResult<Vec<AnalysisArtifact>> {
    let mut cmd = Command::new(&spec.command);
    cmd.args(&spec.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    if let Some(cwd) = &spec.working_dir {
        cmd.current_dir(cwd);
    }
    for (k, v) in &spec.env {
        cmd.env(k, v);
    }

    let mut child = cmd.spawn().map_err(|e| BridgeError::Io {
        code: 11030,
        details: format!("Failed to spawn sidecar: {}", e),
    })?;

    // Write the run request to stdin.
    if let Some(mut stdin) = child.stdin.take() {
        let run_req = SidecarRunRequest {
            api_version: descriptor.api_version.clone(),
            job_id: job_id.to_string(),
            inputs: request.inputs.clone(),
            params: request.params.clone(),
            output_dir: output_dir.to_string(),
            temp_dir: temp_dir.to_string(),
        };
        let bytes = serde_json::to_vec(&run_req).map_err(|e| BridgeError::Internal {
            code: 11031,
            details: e.to_string(),
        })?;
        if let Err(e) = stdin.write_all(&bytes).await {
            warn!("Failed to write sidecar stdin: {}", e);
        }
        let _ = stdin.write_all(b"\n").await;
    }

    let stdout = child.stdout.take().ok_or(BridgeError::Internal {
        code: 11032,
        details: "Missing sidecar stdout".to_string(),
    })?;
    let stderr = child.stderr.take();

    let stderr_handle = if let Some(stderr) = stderr {
        Some(tokio::spawn(async move {
            let mut reader = BufReader::new(stderr);
            let mut buf = String::new();
            let _ = reader.read_to_string(&mut buf).await;
            buf
        }))
    } else {
        None
    };

    let mut artifacts: Vec<AnalysisArtifact> = Vec::new();

    let mut lines = BufReader::new(stdout).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let Ok(json) = serde_json::from_str::<JsonValue>(&line) else {
            debug!("Skipping non-JSON sidecar line: {}", line);
            continue;
        };

        match serde_json::from_value::<SidecarEvent>(json) {
            Ok(SidecarEvent::Progress { pct, message, .. }) => {
                let mut st = status_arc.lock().await;
                if let Some(p) = pct {
                    st.progress = Some(p);
                }
                if message.is_some() {
                    st.message = message.clone();
                }
            }
            Ok(SidecarEvent::Log { level, message, .. }) => {
                debug!(
                    "Sidecar log [{}]: {}",
                    level.unwrap_or_else(|| "info".to_string()),
                    message
                );
            }
            Ok(SidecarEvent::Artifact { artifact, .. }) => {
                artifacts.push(artifact.clone());
            }
            Ok(SidecarEvent::Result {
                artifacts: final_artifacts,
                ..
            }) => {
                artifacts.extend(final_artifacts);
            }
            Ok(SidecarEvent::Error { message, .. }) => {
                return Err(BridgeError::Internal {
                    code: 11040,
                    details: message,
                });
            }
            Err(err) => {
                debug!("Unrecognized sidecar event: {}", err);
            }
        }
    }

    let exit = child.wait().await.map_err(|e| BridgeError::Io {
        code: 11033,
        details: e.to_string(),
    })?;

    if let Some(handle) = stderr_handle {
        if let Ok(stderr_text) = handle.await {
            if !stderr_text.trim().is_empty() && !exit.success() {
                error!("Sidecar stderr: {}", stderr_text);
            }
        }
    }

    if !exit.success() {
        return Err(BridgeError::Internal {
            code: 11034,
            details: format!("Sidecar exited with status {}", exit),
        });
    }

    Ok(artifacts)
}

// --- Tauri command wrappers ---

/// List all registered analyses.
#[tauri::command]
pub async fn list_analyses(
    state: tauri::State<'_, crate::BridgeState>,
) -> BridgeResult<Vec<AnalysisDescriptor>> {
    let reg = state.analysis_registry.lock().await;
    Ok(reg.list())
}

/// Start an analysis job. Returns a job id.
#[tauri::command]
pub async fn start_analysis(
    state: tauri::State<'_, crate::BridgeState>,
    request: AnalysisStartRequest,
) -> BridgeResult<String> {
    start_analysis_job(
        Arc::clone(&state.analysis_registry),
        Arc::clone(&state.analysis_jobs),
        request,
    )
    .await
}

/// Cancel a running analysis job.
#[tauri::command]
pub async fn cancel_analysis(
    state: tauri::State<'_, crate::BridgeState>,
    job_id: String,
) -> BridgeResult<bool> {
    let mut jobs = state.analysis_jobs.lock().await;
    Ok(jobs.cancel(&job_id).await)
}

/// Get a snapshot status for a job.
#[tauri::command]
pub async fn get_analysis_job_status(
    state: tauri::State<'_, crate::BridgeState>,
    job_id: String,
) -> BridgeResult<Option<AnalysisJobStatus>> {
    let jobs = state.analysis_jobs.lock().await;
    Ok(jobs.get_status(&job_id).await)
}
