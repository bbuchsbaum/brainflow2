use bridge_types::{
    BridgeResult, StudioCompareMaterializeRequest, StudioMaterializationJobState,
    StudioMaterializationJobStatus,
};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use uuid::Uuid;

#[derive(Default)]
pub struct StudioMaterializationJobManager {
    jobs: HashMap<String, StudioMaterializationJobEntry>,
}

struct StudioMaterializationJobEntry {
    status: Arc<Mutex<StudioMaterializationJobStatus>>,
    handle: JoinHandle<()>,
}

impl StudioMaterializationJobManager {
    pub fn new() -> Self {
        Self {
            jobs: HashMap::new(),
        }
    }

    pub fn insert(
        &mut self,
        job_id: String,
        status: Arc<Mutex<StudioMaterializationJobStatus>>,
        handle: JoinHandle<()>,
    ) {
        self.jobs
            .insert(job_id, StudioMaterializationJobEntry { status, handle });
    }

    pub async fn get_status(&self, job_id: &str) -> Option<StudioMaterializationJobStatus> {
        let entry = self.jobs.get(job_id)?;
        Some(entry.status.lock().await.clone())
    }

    pub async fn cancel(&mut self, job_id: &str) -> bool {
        let Some(entry) = self.jobs.get(job_id) else {
            return false;
        };

        {
            let mut status = entry.status.lock().await;
            if matches!(
                status.state,
                StudioMaterializationJobState::Completed
                    | StudioMaterializationJobState::Failed
                    | StudioMaterializationJobState::Cancelled
            ) {
                return false;
            }

            status.state = StudioMaterializationJobState::Cancelled;
            status.finished_at_ms = Some(current_time_ms());
            status.progress = Some(status.progress.unwrap_or(0.0));
            status.message = Some("Cancelled by user".to_string());
        }

        entry.handle.abort();
        true
    }
}

pub async fn start_compare_materialization_job(
    jobs: Arc<Mutex<StudioMaterializationJobManager>>,
    request: StudioCompareMaterializeRequest,
) -> BridgeResult<String> {
    let job_id = Uuid::new_v4().to_string();
    let status = StudioMaterializationJobStatus {
        job_id: job_id.clone(),
        state: StudioMaterializationJobState::Queued,
        started_at_ms: Some(current_time_ms()),
        finished_at_ms: None,
        progress: Some(0.0),
        message: Some("Queued".to_string()),
        result: None,
        error: None,
    };
    let status_arc = Arc::new(Mutex::new(status));
    let status_for_worker = Arc::clone(&status_arc);

    let handle = tokio::spawn(async move {
        {
            let mut status = status_for_worker.lock().await;
            status.state = StudioMaterializationJobState::Running;
            status.progress = Some(0.1);
            status.message = Some("Materializing compare panes".to_string());
        }

        let result =
            tokio::task::spawn_blocking(move || field_table::materialize_compare_panes(request))
                .await;

        let mut status = status_for_worker.lock().await;
        if status.state == StudioMaterializationJobState::Cancelled {
            return;
        }

        match result {
            Ok(panes) => {
                status.state = StudioMaterializationJobState::Completed;
                status.finished_at_ms = Some(current_time_ms());
                status.progress = Some(1.0);
                status.message = Some("Completed".to_string());
                status.result = Some(panes);
                status.error = None;
            }
            Err(err) => {
                status.state = StudioMaterializationJobState::Failed;
                status.finished_at_ms = Some(current_time_ms());
                status.progress = Some(status.progress.unwrap_or(0.1));
                status.message = Some("Failed".to_string());
                status.error = Some(err.to_string());
            }
        }
    });

    {
        let mut jobs_guard = jobs.lock().await;
        jobs_guard.insert(job_id.clone(), Arc::clone(&status_arc), handle);
    }

    Ok(job_id)
}

fn current_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blocked_request() -> StudioCompareMaterializeRequest {
        StudioCompareMaterializeRequest {
            support_label: "MNI152 2mm template".to_string(),
            compare_ready: false,
            force_rematerialize: false,
            active_member_id: Some("sub001".to_string()),
            active_member_source_path: Some("/missing/sub001.nii.gz".to_string()),
            cohort_member_source_paths: Vec::new(),
            compare_cohort_id: Some("controls".to_string()),
            compare_cohort_label: Some("Controls".to_string()),
            compare_cohort_member_count: Some(0),
            active_expression_label: Some("Z-score".to_string()),
            active_expression_recipe: Some("zscore(current, cohort:controls)".to_string()),
            reducer_specs: None,
            active_member_role_bindings: None,
            cohort_member_role_bindings: None,
        }
    }

    #[tokio::test]
    async fn materialization_job_completes_with_compare_pane_result() {
        let jobs = Arc::new(Mutex::new(StudioMaterializationJobManager::new()));
        let job_id = start_compare_materialization_job(Arc::clone(&jobs), blocked_request())
            .await
            .expect("start job");

        let mut final_status = None;
        for _ in 0..20 {
            let status = jobs.lock().await.get_status(&job_id).await.expect("status");
            if status.state == StudioMaterializationJobState::Completed {
                final_status = Some(status);
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }

        let status = final_status.expect("completed status");
        assert_eq!(status.progress, Some(1.0));
        assert_eq!(status.result.as_ref().map(Vec::len), Some(4));
    }

    #[tokio::test]
    async fn cancel_unknown_materialization_job_returns_false() {
        let mut jobs = StudioMaterializationJobManager::new();
        assert!(!jobs.cancel("missing").await);
    }
}
