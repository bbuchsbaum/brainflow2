use super::*;
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tokio::sync::Notify;

fn prepared() -> PreparedVolume {
    let space = volmath::NeuroSpace::new(vec![2, 3, 4], None, None, None, None).unwrap();
    let volume = volmath::DenseVolume3::from_data(space, vec![1_f32; 24]);
    PreparedVolume {
        data: VolumeSendable::VolF32(volume, Default::default()),
        metadata: VolumeMetadataInfo {
            name: "brain.nii".into(),
            path: "memory:brain".into(),
            dtype: "f32".into(),
            volume_type: bridge_types::VolumeType::Volume3D,
            time_series_info: None,
        },
        handle: VolumeHandleInfo {
            id: "volume".into(),
            name: "brain.nii".into(),
            dims: vec![2, 3, 4],
            dtype: "f32".into(),
            volume_type: bridge_types::VolumeType::Volume3D,
            num_timepoints: None,
            current_timepoint: None,
            time_series_info: None,
            statistic: None,
            is_label_map: Some(false),
        },
    }
}

struct Source {
    volume: Mutex<Option<PreparedVolume>>,
    started: Notify,
    finish: Notify,
    wait: bool,
    fail: bool,
}

impl Source {
    fn new(wait: bool, fail: bool) -> Self {
        Self {
            volume: Mutex::new(Some(prepared())),
            started: Notify::new(),
            finish: Notify::new(),
            wait,
            fail,
        }
    }
}

#[async_trait]
impl VolumeSource for Source {
    async fn acquire(&self, _: &LoadScope) -> BridgeResult<PreparedVolume> {
        let volume = self.volume.lock().unwrap().take().unwrap();
        self.started.notify_one();
        if self.wait {
            self.finish.notified().await;
        }
        if self.fail {
            return Err(BridgeError::Io {
                code: 1003,
                details: "source aborted".into(),
            });
        }
        Ok(volume)
    }
}

#[derive(Default)]
struct Repository {
    volumes: Mutex<HashMap<String, Arc<VolumeSendable>>>,
    reject: AtomicBool,
    active: AtomicBool,
    wait: AtomicBool,
    publishing: Notify,
    finish: Notify,
}

#[async_trait]
impl VolumeRepository for Repository {
    async fn publish(
        &self,
        volume: PreparedVolume,
        scope: &LoadScope,
    ) -> BridgeResult<VolumeHandleInfo> {
        self.publishing.notify_one();
        if self.wait.load(Ordering::SeqCst) {
            self.finish.notified().await;
        }
        if self.reject.load(Ordering::SeqCst) {
            return Err(BridgeError::Internal {
                code: 1004,
                details: "publication failed".into(),
            });
        }
        scope.commit(|| {
            self.volumes
                .lock()
                .unwrap()
                .insert(volume.handle.id.clone(), Arc::new(volume.data));
            Ok(volume.handle)
        })
    }
    async fn remove(&self, id: &str) -> BridgeResult<()> {
        if self.active.load(Ordering::SeqCst) {
            return Err(BridgeError::Input {
                code: 4048,
                details: "active layer".into(),
            });
        }
        self.volumes
            .lock()
            .unwrap()
            .remove(id)
            .ok_or_else(|| BridgeError::VolumeNotFound {
                code: 4041,
                details: id.into(),
            })?;
        Ok(())
    }
}

#[tokio::test]
async fn load_register_unload_releases_the_owned_volume() {
    let repository = Repository::default();
    let handle = VolumeLoadingService::load(
        &Source::new(false, false),
        &repository,
        &LoadScope::default(),
    )
    .await
    .unwrap();
    let weak = Arc::downgrade(repository.volumes.lock().unwrap().get(&handle.id).unwrap());
    assert!(weak.upgrade().is_some());
    VolumeLoadingService::unload(&repository, &handle.id)
        .await
        .unwrap();
    assert!(weak.upgrade().is_none());
    assert!(VolumeLoadingService::unload(&repository, &handle.id)
        .await
        .is_err());
}

#[tokio::test]
async fn aborted_source_and_failed_publication_leave_no_registry_entry() {
    for source_fails in [true, false] {
        let repository = Repository::default();
        repository.reject.store(!source_fails, Ordering::SeqCst);
        let scope = LoadScope::default();
        assert!(
            VolumeLoadingService::load(&Source::new(false, source_fails), &repository, &scope)
                .await
                .is_err()
        );
        assert!(repository.volumes.lock().unwrap().is_empty());
        assert!(scope.check().is_err());
    }
}

#[tokio::test]
async fn closing_destination_during_acquisition_refuses_late_data() {
    let source = Source::new(true, false);
    let repository = Repository::default();
    let scope = LoadScope::default();
    let mut load = Box::pin(VolumeLoadingService::load(&source, &repository, &scope));
    tokio::select! { _ = source.started.notified() => {}, _ = &mut load => panic!("source must wait") }
    scope.close();
    source.finish.notify_one();
    assert!(load.await.is_err());
    assert!(repository.volumes.lock().unwrap().is_empty());
}

#[tokio::test]
async fn dropping_caller_revokes_publication_right() {
    let source = Source::new(true, false);
    let repository = Repository::default();
    let scope = LoadScope::default();
    let mut load = Box::pin(VolumeLoadingService::load(&source, &repository, &scope));
    tokio::select! { _ = source.started.notified() => {}, _ = &mut load => panic!("source must wait") }
    drop(load);
    assert!(scope.check().is_err());
    assert!(repository.volumes.lock().unwrap().is_empty());
}

#[tokio::test]
async fn closing_destination_while_waiting_to_publish_refuses_insertion() {
    let source = Source::new(false, false);
    let repository = Repository::default();
    repository.wait.store(true, Ordering::SeqCst);
    let scope = LoadScope::default();
    let mut load = Box::pin(VolumeLoadingService::load(&source, &repository, &scope));
    tokio::select! { _ = repository.publishing.notified() => {}, _ = &mut load => panic!("publication must wait") }
    scope.close();
    repository.finish.notify_one();
    assert!(load.await.is_err());
    assert!(repository.volumes.lock().unwrap().is_empty());
}

#[tokio::test]
async fn active_layer_refusal_retains_volume_until_release() {
    let repository = Repository::default();
    VolumeLoadingService::load(
        &Source::new(false, false),
        &repository,
        &LoadScope::default(),
    )
    .await
    .unwrap();
    repository.active.store(true, Ordering::SeqCst);
    assert!(VolumeLoadingService::unload(&repository, "volume")
        .await
        .is_err());
    assert_eq!(repository.volumes.lock().unwrap().len(), 1);
    repository.active.store(false, Ordering::SeqCst);
    VolumeLoadingService::unload(&repository, "volume")
        .await
        .unwrap();
    assert!(repository.volumes.lock().unwrap().is_empty());
}
