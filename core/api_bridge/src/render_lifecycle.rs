//! Serialize service creation and publish only a fully ready instance.
use std::{future::Future, sync::Arc};
use tokio::sync::Mutex;

pub(crate) async fn initialize_once<T, E, F, Fut>(
    slot: &Mutex<Option<Arc<Mutex<T>>>>,
    initialize: F,
) -> Result<Arc<Mutex<T>>, E>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<T, E>>,
{
    let mut guard = slot.lock().await;
    if let Some(service) = guard.as_ref() {
        return Ok(Arc::clone(service));
    }
    let service = Arc::new(Mutex::new(initialize().await?));
    *guard = Some(Arc::clone(&service));
    Ok(service)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[tokio::test]
    async fn concurrent_callers_share_one_fully_ready_instance() {
        let slot = Mutex::new(None);
        let calls = AtomicUsize::new(0);
        let initialize = || async {
            calls.fetch_add(1, Ordering::SeqCst);
            tokio::task::yield_now().await;
            Ok::<_, ()>("shaders ready")
        };
        let (first, second) = tokio::join!(
            initialize_once(&slot, initialize),
            initialize_once(&slot, initialize),
        );
        let (first, second) = (first.unwrap(), second.unwrap());
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(Arc::ptr_eq(&first, &second));
        assert_eq!(*second.lock().await, "shaders ready");
        assert!(Arc::ptr_eq(slot.lock().await.as_ref().unwrap(), &first));
    }

    #[tokio::test]
    async fn failed_creation_leaves_no_partial_service_and_can_retry() {
        let slot = Mutex::new(None);
        let failed = initialize_once(&slot, || async { Err::<u32, _>("shader failure") }).await;
        assert_eq!(failed.unwrap_err(), "shader failure");
        assert!(slot.lock().await.is_none());
        let ready = initialize_once(&slot, || async { Ok::<_, &str>(42) })
            .await
            .unwrap();
        assert_eq!(*ready.lock().await, 42);
    }
}
