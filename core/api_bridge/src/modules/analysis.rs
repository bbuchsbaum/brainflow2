//! Analysis module: bridge adapter.
//!
//! Domain logic (manifests, registry, job manager, builtin and sidecar runners)
//! lives in the transport-neutral `bf_analysis` crate. This file owns the module
//! descriptor, its state slot, the `on_disable` hook and the four `#[command]`s.
//!
//! The command names predate the `<module>_` prefix rule and are kept because the
//! UI and the dev harness call them by name.

use super::{BridgeModule, ModuleCtx, ModuleDescriptor, ModuleHost, ModuleSlots, ModuleStage};
use crate::BridgeState;
use async_trait::async_trait;
use bf_analysis::{AnalysisJobManager, AnalysisRegistry};
use bridge_types::{AnalysisDescriptor, AnalysisJobStatus, AnalysisStartRequest, BridgeResult};
use log::info;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

pub(crate) const ID: &str = "analysis";

static DESCRIPTOR: ModuleDescriptor = ModuleDescriptor {
    id: ID,
    title: "Analysis",
    version: "0.1.0",
    stage: ModuleStage::Preview,
};

/// Status message for jobs cancelled because the module was switched off.
const DISABLED_MESSAGE: &str = "Cancelled because the analysis module was disabled";

pub(crate) struct AnalysisModule;

pub(crate) static MODULE: AnalysisModule = AnalysisModule;

/// The analysis module's state slot. Lock order: `registry` and `jobs` are never
/// held together; `jobs` is taken before an individual job status.
pub(crate) struct AnalysisState {
    registry: Arc<Mutex<AnalysisRegistry>>,
    jobs: Arc<Mutex<AnalysisJobManager>>,
}

impl AnalysisState {
    fn new(registry: AnalysisRegistry) -> Self {
        Self {
            registry: Arc::new(Mutex::new(registry)),
            jobs: Arc::new(Mutex::new(AnalysisJobManager::new())),
        }
    }
}

#[async_trait]
impl BridgeModule for AnalysisModule {
    fn descriptor(&self) -> &'static ModuleDescriptor {
        &DESCRIPTOR
    }

    fn register_state(&self, slots: &mut ModuleSlots) {
        slots.insert(AnalysisState::new(bf_analysis::build_default_registry()));
    }

    /// Cancel queued and running jobs (aborting a sidecar kills its process).
    /// Finished job statuses are kept for when the module is switched back on.
    async fn on_disable(&self, ctx: &ModuleCtx<'_>) {
        let Some(state) = ctx.state::<AnalysisState>() else {
            return;
        };
        let cancelled = state
            .jobs
            .lock()
            .await
            .cancel_active(DISABLED_MESSAGE)
            .await;
        if cancelled > 0 {
            info!("Analysis module disabled; cancelled {cancelled} running job(s)");
        }
    }
}

// --- Command bodies (testable without Tauri) ---

async fn list(modules: &ModuleHost) -> BridgeResult<Vec<AnalysisDescriptor>> {
    let analysis = modules.enter::<AnalysisState>(ID).await?;
    let registry = analysis.registry.lock().await;
    Ok(registry.list())
}

async fn start(modules: &ModuleHost, request: AnalysisStartRequest) -> BridgeResult<String> {
    // The gate guard is held until the job is registered, so `on_disable`
    // always sees (and cancels) a job started just before the module went off.
    let analysis = modules.enter::<AnalysisState>(ID).await?;
    bf_analysis::start_analysis_job(
        Arc::clone(&analysis.registry),
        Arc::clone(&analysis.jobs),
        request,
    )
    .await
}

async fn cancel(modules: &ModuleHost, job_id: &str) -> BridgeResult<bool> {
    let analysis = modules.enter::<AnalysisState>(ID).await?;
    let mut jobs = analysis.jobs.lock().await;
    Ok(jobs.cancel(job_id).await)
}

async fn status(modules: &ModuleHost, job_id: &str) -> BridgeResult<Option<AnalysisJobStatus>> {
    let analysis = modules.enter::<AnalysisState>(ID).await?;
    let jobs = analysis.jobs.lock().await;
    Ok(jobs.get_status(job_id).await)
}

// --- Tauri commands ---

/// List all registered analyses.
#[tauri::command]
pub async fn list_analyses(state: State<'_, BridgeState>) -> BridgeResult<Vec<AnalysisDescriptor>> {
    list(&state.modules).await
}

/// Start an analysis job. Returns a job id.
#[tauri::command]
pub async fn start_analysis(
    state: State<'_, BridgeState>,
    request: AnalysisStartRequest,
) -> BridgeResult<String> {
    start(&state.modules, request).await
}

/// Cancel a running analysis job.
#[tauri::command]
pub async fn cancel_analysis(state: State<'_, BridgeState>, job_id: String) -> BridgeResult<bool> {
    cancel(&state.modules, &job_id).await
}

/// Get a snapshot status for a job.
#[tauri::command]
pub async fn get_analysis_job_status(
    state: State<'_, BridgeState>,
    job_id: String,
) -> BridgeResult<Option<AnalysisJobStatus>> {
    status(&state.modules, &job_id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use bridge_types::{AnalysisInput, AnalysisInputKind, AnalysisJobState, BridgeError};
    use serde_json::json;
    use std::time::Duration;

    static ANALYSIS_ONLY: &[&dyn BridgeModule] = &[&MODULE];

    fn assert_disabled<T: std::fmt::Debug>(result: BridgeResult<T>) {
        match result {
            Err(BridgeError::ModuleDisabled { module, .. }) => assert_eq!(module, ID),
            other => panic!("expected ModuleDisabled, got {other:?}"),
        }
    }

    fn copy_request(path: &std::path::Path) -> AnalysisStartRequest {
        AnalysisStartRequest {
            analysis_id: "builtin-copy-volume".to_string(),
            inputs: vec![AnalysisInput {
                kind: AnalysisInputKind::Volume,
                handle: Some("vol-1".to_string()),
                path: Some(path.to_string_lossy().to_string()),
                name: Some("Source Volume".to_string()),
                metadata: json!({}),
            }],
            params: json!({}),
        }
    }

    #[tokio::test]
    async fn analysis_commands_run_while_enabled() {
        let host = ModuleHost::new(ANALYSIS_ONLY);
        let analyses = list(&host).await.expect("list analyses");
        assert!(analyses.iter().any(|d| d.id == "builtin-copy-volume"));

        let dir = std::env::temp_dir().join(format!(
            "brainflow-analysis-adapter-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).expect("create source dir");
        let source = dir.join("source-volume.nii.gz");
        std::fs::write(&source, b"fake-nifti").expect("write source");

        let job_id = start(&host, copy_request(&source)).await.expect("start");
        let final_state = loop {
            let snapshot = status(&host, &job_id)
                .await
                .expect("status")
                .expect("job exists");
            match snapshot.state {
                AnalysisJobState::Queued | AnalysisJobState::Running => {
                    tokio::time::sleep(Duration::from_millis(20)).await
                }
                state => break state,
            }
        };
        assert_eq!(final_state, AnalysisJobState::Completed);
        assert!(!cancel(&host, "no-such-job").await.expect("cancel unknown"));

        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn analysis_commands_reject_while_disabled() {
        let host = ModuleHost::new(ANALYSIS_ONLY);
        host.set_enabled(&[]).await.expect("disable analysis");

        assert_disabled(list(&host).await);
        assert_disabled(start(&host, copy_request(std::path::Path::new("/nope"))).await);
        assert_disabled(cancel(&host, "job").await);
        assert_disabled(status(&host, "job").await);

        host.set_enabled(&[ID.to_string()])
            .await
            .expect("re-enable analysis");
        assert!(list(&host).await.is_ok());
    }

    #[tokio::test]
    async fn disabling_analysis_cancels_running_jobs() {
        let host = ModuleHost::new(ANALYSIS_ONLY);
        let state = host.state::<AnalysisState>().expect("analysis state");
        let job_status = Arc::new(Mutex::new(AnalysisJobStatus {
            job_id: "long-job".to_string(),
            analysis_id: "builtin-copy-volume".to_string(),
            state: AnalysisJobState::Running,
            started_at_ms: Some(0),
            finished_at_ms: None,
            progress: None,
            message: Some("Running".to_string()),
            artifacts: None,
            error: None,
        }));
        state.jobs.lock().await.insert(
            "long-job".to_string(),
            Arc::clone(&job_status),
            tokio::spawn(std::future::pending::<()>()),
        );

        host.set_enabled(&[]).await.expect("disable analysis");
        {
            let snapshot = job_status.lock().await;
            assert_eq!(snapshot.state, AnalysisJobState::Cancelled);
            assert_eq!(snapshot.message.as_deref(), Some(DISABLED_MESSAGE));
        }

        // The cancelled status stays visible once the module is back on.
        host.set_enabled(&[ID.to_string()])
            .await
            .expect("re-enable analysis");
        let snapshot = status(&host, "long-job")
            .await
            .expect("status")
            .expect("job kept");
        assert_eq!(snapshot.state, AnalysisJobState::Cancelled);
    }
}
