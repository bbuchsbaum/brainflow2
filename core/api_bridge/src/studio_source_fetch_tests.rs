//! Population sampling and Compare materialization on a remote set, against
//! the in-process SFTP fixture of `remote_transfer_tests.rs`.
use super::*;
use crate::studio_source_fetch::{
    self as fetch, StudioSourceFetchProgress, StudioSourceFetchRequest, StudioSourceFetchStatus,
    StudioSourceRef,
};
use std::path::{Path, PathBuf};

struct Remote {
    server: StartedSftpServer,
    client: Arc<RemoteClient>,
    mount: crate::RemoteMountEntry,
    state: crate::BridgeState,
    root: PathBuf,
    _cleanup: crate::remote_transfer::Staging,
}

impl Remote {
    async fn start() -> Self {
        let server = spawn_sftp_server(
            PrivateKey::random(&mut rand::rng(), russh::keys::Algorithm::Ed25519).unwrap(),
            Arc::new(AtomicUsize::new(0)),
            Arc::new(AtomicUsize::new(0)),
        )
        .await;
        let config = ConnectConfig::new(server.addr.ip().to_string(), "fixture")
            .port(server.addr.port())
            .auth(AuthMethod::Password("ephemeral-test-only".into()))
            .connect_timeout(Duration::from_secs(5))
            .operation_timeout(Duration::from_secs(5))
            .retry_count(0)
            .skip_host_key_verification();
        let client = Arc::new(RemoteClient::connect(config).await.unwrap());
        let root =
            std::env::temp_dir().join(format!("brainflow-sftp-studio-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let mount = crate::RemoteMountEntry {
            mount_id: "fixture".into(),
            local_root: root.clone(),
            remote_root: "/".into(),
            display_name: "fixture".into(),
            origin_label: "fixture".into(),
            host: "127.0.0.1".into(),
            connect_host: "127.0.0.1".into(),
            port: server.addr.port(),
            user: "fixture".into(),
            client: client.clone(),
            op_semaphore: Arc::new(tokio::sync::Semaphore::new(
                crate::REMOTE_MOUNT_MAX_CONCURRENT_OPS,
            )),
            transfers: Arc::new(crate::remote_transfer::Control::default()),
            progress: Arc::new(|_| {}),
        };
        let state = crate::BridgeState::default().unwrap();
        state
            .remote_mounts
            .lock()
            .await
            .insert("fixture".into(), mount.clone());
        Self {
            server,
            client,
            mount,
            state,
            _cleanup: crate::remote_transfer::Staging(root.clone()),
            root,
        }
    }

    /// The local cache path of `/popset/<relative>`.
    fn local(&self, relative: &str) -> PathBuf {
        self.root.join("popset").join(relative)
    }

    async fn finish(self) {
        // The sidecars of this fixture's endpoint live in the app's cache.
        if let Ok(metadata) = crate::remote_cache_metadata_root() {
            let _ = std::fs::remove_dir_all(metadata.join(crate::remote_cache::identity(
                &self.mount.host,
                self.mount.port,
                &self.mount.user,
                &self.mount.remote_root,
            )));
        }
        self.mount.transfers.stop();
        let _ = self.client.close().await;
        self.server.shutdown.shutdown("done".into());
        let _ = self.server.join.await;
    }
}

fn sources(paths: &[(&str, &Path)]) -> Vec<StudioSourceRef> {
    paths
        .iter()
        .map(|(label, path)| StudioSourceRef {
            path: path.to_string_lossy().into_owned(),
            label: Some((*label).to_string()),
        })
        .collect()
}

type Reports = Arc<std::sync::Mutex<Vec<StudioSourceFetchProgress>>>;

async fn run_fetch(
    remote: &Remote,
    sources: Vec<StudioSourceRef>,
    allow_large: bool,
) -> (
    crate::BridgeResult<fetch::StudioSourceFetchResult>,
    Vec<(usize, usize)>,
) {
    let reports: Reports = Arc::default();
    let sink = reports.clone();
    let request = StudioSourceFetchRequest {
        fetch_id: uuid::Uuid::new_v4().to_string(),
        sources,
        allow_large,
    };
    let (_registration, cancel) = remote
        .state
        .studio_source_fetches
        .begin(&request.fetch_id)
        .unwrap();
    let result = fetch::fetch_sources(&remote.state, &request, cancel, &move |progress| {
        sink.lock().unwrap().push(progress)
    })
    .await;
    let counts = reports
        .lock()
        .unwrap()
        .iter()
        .map(|progress| (progress.done, progress.total))
        .collect();
    (result, counts)
}

fn population_request(
    members: &[(&str, &Path)],
) -> crate::population_slice::PopulationSliceRequest {
    serde_json::from_value(serde_json::json!({
        "contextKey": "workspace:remote-set:revision",
        "members": members.iter().map(|(id, path)| serde_json::json!({
            "memberId": id,
            "sourcePath": path.to_string_lossy(),
        })).collect::<Vec<_>>(),
        "workingMemberIds": members.iter().map(|(id, _)| *id).collect::<Vec<_>>(),
        "focusMemberId": members[0].0,
        "crosshairMm": [0.0, 0.0, 0.0],
        "orientation": "axial",
        "dimPx": [2, 2],
        "zoom": 1.0,
        "summary": "mean",
    }))
    .unwrap()
}

fn compare_request(
    member: &Path,
    cohort: &[&Path],
) -> bridge_types::StudioCompareMaterializeRequest {
    bridge_types::StudioCompareMaterializeRequest {
        support_label: format!("remote fixture {}", uuid::Uuid::new_v4()),
        compare_ready: true,
        force_rematerialize: true,
        active_member_id: Some("sub-01".into()),
        active_member_source_path: Some(member.to_string_lossy().into_owned()),
        cohort_member_source_paths: cohort
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect(),
        compare_cohort_id: Some("everyone".into()),
        compare_cohort_label: Some("All members".into()),
        compare_cohort_member_count: Some(cohort.len()),
        active_expression_label: None,
        active_expression_recipe: None,
        reducer_specs: None,
        active_member_role_bindings: None,
        cohort_member_role_bindings: None,
    }
}

fn staging_left(directory: &Path) -> Vec<String> {
    std::fs::read_dir(directory)
        .map(|entries| {
            entries
                .flatten()
                .map(|entry| entry.file_name().to_string_lossy().into_owned())
                .filter(|name| name.starts_with(".transfer-"))
                .collect()
        })
        .unwrap_or_default()
}

/// The lens asks for the files it reads and no others; then Population and
/// Compare read them from the cache. A second request fetches nothing, and a
/// local set never reaches the mount.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn remote_population_and_compare_fetch_exactly_the_files_they_read() {
    let remote = Remote::start().await;
    let paths: Vec<PathBuf> = (1..=3)
        .map(|n| remote.local(&format!("exact/sub-0{n}/same_item.nii")))
        .collect();
    let other = remote.local("exact/sub-01/other_item.nii");
    let members: Vec<(&str, &Path)> = ["sub-01", "sub-02", "sub-03"]
        .into_iter()
        .zip(paths.iter().map(PathBuf::as_path))
        .collect();

    // Before the fetch the member is said to be unfetched, in plain words.
    let unfetched = remote
        .state
        .population_slice
        .evaluate(
            population_request(&members),
            &remote.state,
            crate::SampleCancellation::default(),
        )
        .await
        .unwrap_err();
    assert!(
        matches!(&unfetched, crate::BridgeError::Io { code, details }
            if *code == fetch::CODE_NOT_FETCHED
                && details == "same_item.nii has not been fetched from 127.0.0.1 yet."),
        "{unfetched:?}"
    );
    assert!(pop_reads("/popset/exact/").is_empty());

    let (result, reports) = run_fetch(&remote, sources(&members), false).await;
    let result = result.unwrap();
    assert_eq!(result.status, StudioSourceFetchStatus::Ready);
    assert_eq!(result.mount_label.as_deref(), Some("127.0.0.1"));
    assert_eq!(
        (
            result.remote_count,
            result.fetch_count,
            result.fetched_count
        ),
        (3, 3, 3)
    );
    assert_eq!(reports, vec![(0, 3), (1, 3), (2, 3), (3, 3)]);
    let read = pop_reads("/popset/exact/");
    assert_eq!(read.len(), 3, "{read:?}");
    for n in 1..=3 {
        assert_eq!(read[&format!("/popset/exact/sub-0{n}/same_item.nii")], 1);
    }
    assert!(!other.exists(), "an image nothing asked for is not fetched");
    assert_eq!(
        remote.mount.op_semaphore.available_permits(),
        crate::REMOTE_MOUNT_MAX_CONCURRENT_OPS
    );

    let population = remote
        .state
        .population_slice
        .evaluate(
            population_request(&members),
            &remote.state,
            crate::SampleCancellation::default(),
        )
        .await
        .unwrap();
    assert_eq!(population.unit_count, 3);
    let finite: Vec<f32> = population
        .summary
        .iter()
        .copied()
        .filter(|value| value.is_finite())
        .collect();
    assert!(!finite.is_empty());
    assert!(finite.iter().all(|value| (value - 2.0).abs() < 1e-6));

    let cohort: Vec<&Path> = paths.iter().map(PathBuf::as_path).collect();
    let panes = tokio::task::spawn_blocking({
        let request = compare_request(&paths[0], &cohort);
        move || field_table::materialize_compare_panes(request)
    })
    .await
    .unwrap();
    let mean = panes.iter().find(|pane| pane.id == "cohort-mean").unwrap();
    assert!(
        mean.binding.as_ref().is_some_and(|binding| binding.ready),
        "{}",
        mean.reason
    );
    let residual = panes.iter().find(|pane| pane.id == "residual").unwrap();
    assert!(
        residual
            .binding
            .as_ref()
            .is_some_and(|binding| binding.ready),
        "{}",
        residual.reason
    );

    // Everything is cached: nothing is read again.
    let (again, reports) = run_fetch(&remote, sources(&members), false).await;
    let again = again.unwrap();
    assert_eq!((again.fetch_count, again.fetched_count), (0, 0));
    assert!(reports.is_empty());
    assert_eq!(pop_reads("/popset/exact/"), read);

    // A local set has no fetch step at all.
    let local = crate::set_sample_cache::TestSource::new(&[2, 2, 2], &[1.0; 8]);
    let (local_result, reports) =
        run_fetch(&remote, sources(&[("local", &local.path)]), false).await;
    let local_result = local_result.unwrap();
    assert_eq!(local_result.status, StudioSourceFetchStatus::Ready);
    assert_eq!(local_result.mount_label, None);
    assert_eq!(local_result.remote_count, 0);
    assert!(reports.is_empty());
    assert_eq!(pop_reads("/popset/exact/"), read);

    remote.finish().await;
}

/// Cancelling during a download removes its staging file and keeps what had
/// finished; the next request fetches only what is still missing.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn remote_fetch_cancel_leaves_no_partial_file_and_the_next_run_continues() {
    let remote = Arc::new(Remote::start().await);
    let first = remote.local("cancel/sub-01/same_item.nii");
    let slow = remote.local("cancel/sub-02-slow/same_item.nii");
    let last = remote.local("cancel/sub-03/same_item.nii");
    let members = [
        ("sub-01", first.as_path()),
        ("sub-02", slow.as_path()),
        ("sub-03", last.as_path()),
    ];

    let request = StudioSourceFetchRequest {
        fetch_id: uuid::Uuid::new_v4().to_string(),
        sources: sources(&members),
        allow_large: false,
    };
    let (registration, cancel) = remote
        .state
        .studio_source_fetches
        .begin(&request.fetch_id)
        .unwrap();
    let fetch_id = request.fetch_id.clone();
    let worker = tokio::spawn({
        let remote = remote.clone();
        async move {
            let _registration = registration;
            fetch::fetch_sources(&remote.state, &request, cancel, &|_| {}).await
        }
    });
    tokio::time::timeout(Duration::from_secs(5), async {
        while !pop_reads("/popset/cancel/").contains_key("/popset/cancel/sub-02-slow/same_item.nii")
        {
            sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("the slow download starts");
    assert!(remote.state.studio_source_fetches.cancel(&fetch_id));
    let error = worker.await.unwrap().unwrap_err();
    assert!(
        matches!(&error, crate::BridgeError::Input { code, .. } if *code == fetch::CODE_CANCELLED),
        "{error:?}"
    );
    assert!(first.exists(), "a finished file stays in the cache");
    assert!(!slow.exists(), "a cancelled download is not published");
    assert!(!last.exists(), "nothing after the cancellation is fetched");
    assert_eq!(staging_left(slow.parent().unwrap()), Vec::<String>::new());
    assert_eq!(
        remote.mount.op_semaphore.available_permits(),
        crate::REMOTE_MOUNT_MAX_CONCURRENT_OPS
    );

    let (result, reports) = run_fetch(&remote, sources(&members), false).await;
    let result = result.unwrap();
    assert_eq!(
        (
            result.remote_count,
            result.fetch_count,
            result.fetched_count
        ),
        (3, 2, 2)
    );
    assert_eq!(reports, vec![(1, 3), (2, 3), (3, 3)]);
    let read = pop_reads("/popset/cancel/");
    assert_eq!(read["/popset/cancel/sub-01/same_item.nii"], 1);
    assert_eq!(read["/popset/cancel/sub-02-slow/same_item.nii"], 2);
    assert_eq!(read["/popset/cancel/sub-03/same_item.nii"], 1);
    assert_eq!(
        std::fs::read(&slow).unwrap(),
        pop_image("/popset/cancel/sub-02-slow/same_item.nii")
    );

    // A cancellation that arrives before its fetch registers still refuses it.
    let early = uuid::Uuid::new_v4().to_string();
    assert!(!remote.state.studio_source_fetches.cancel(&early));
    let refused = remote
        .state
        .studio_source_fetches
        .begin(&early)
        .err()
        .unwrap();
    assert!(
        matches!(&refused, crate::BridgeError::Input { code, .. } if *code == fetch::CODE_CANCELLED)
    );

    Arc::try_unwrap(remote).ok().unwrap().finish().await;
}

/// A file that is not on the server is named with its member and the host,
/// and nothing is downloaded. A fetch above the size guard asks first.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn remote_fetch_names_a_missing_member_and_asks_before_a_large_fetch() {
    let remote = Remote::start().await;
    let present = remote.local("absent/sub-01/same_item.nii");
    let absent = remote.local("absent/sub-missing/same_item.nii");
    let (result, reports) = run_fetch(
        &remote,
        sources(&[("sub-01", &present), ("sub-1014", &absent)]),
        false,
    )
    .await;
    let error = result.unwrap_err();
    assert!(
        matches!(&error, crate::BridgeError::Io { code, details }
            if *code == fetch::CODE_MISSING
                && details == "sub-1014: same_item.nii is not on 127.0.0.1."),
        "{error:?}"
    );
    assert!(!error.to_string().contains("os error"));
    assert!(reports.is_empty());
    assert!(pop_reads("/popset/absent/").is_empty());
    assert!(!present.exists());

    // One 3 GiB image and one small one: above the confirmation size, within
    // the cache budget. (`huge` anywhere in a path makes the file 3 GiB.)
    let huge = remote.local("huge/sub-01/same_item.nii");
    let small = remote.local("confirm/sub-02/same_item.nii");
    let large = sources(&[("sub-01", &huge), ("sub-02", &small)]);
    let (result, reports) = run_fetch(&remote, large, false).await;
    let result = result.unwrap();
    assert_eq!(result.status, StudioSourceFetchStatus::NeedsConfirmation);
    assert_eq!(result.fetch_count, 2);
    assert!(result.fetch_bytes > fetch::LARGE_FETCH_CONFIRM_BYTES);
    assert_eq!(result.fetched_count, 0);
    assert!(reports.is_empty());
    assert!(
        pop_reads("/popset/huge").is_empty() && pop_reads("/popset/confirm").is_empty(),
        "nothing is fetched unasked"
    );

    // Several missing images: the count, and up to three by name.
    let gone: Vec<PathBuf> = (1..=5)
        .map(|n| remote.local(&format!("absent/sub-missing-{n}/same_item.nii")))
        .collect();
    let labels = ["sub-2001", "sub-2002", "sub-2003", "sub-2004", "sub-2005"];
    let named = |count: usize| {
        let mut members: Vec<(&str, &Path)> = vec![("sub-01", present.as_path())];
        members.extend(
            labels
                .iter()
                .copied()
                .zip(gone.iter().map(PathBuf::as_path))
                .take(count),
        );
        sources(&members)
    };
    for (count, expected) in [
        (2, "2 images are not on 127.0.0.1: sub-2001: same_item.nii and sub-2002: same_item.nii."),
        (3, "3 images are not on 127.0.0.1: sub-2001: same_item.nii, sub-2002: same_item.nii and sub-2003: same_item.nii."),
        (4, "4 images are not on 127.0.0.1: sub-2001: same_item.nii, sub-2002: same_item.nii, sub-2003: same_item.nii and 1 other."),
        (5, "5 images are not on 127.0.0.1: sub-2001: same_item.nii, sub-2002: same_item.nii, sub-2003: same_item.nii and 2 others."),
    ] {
        let (result, _) = run_fetch(&remote, named(count), false).await;
        let error = result.unwrap_err();
        assert!(
            matches!(&error, crate::BridgeError::Io { code, details }
                if *code == fetch::CODE_MISSING && details == expected),
            "{error:?}"
        );
    }
    assert!(pop_reads("/popset/absent/").is_empty());
    assert!(
        !present.exists(),
        "one missing member still blocks the fetch"
    );

    remote.finish().await;
}

/// A set that cannot fit in the cache is refused after the stat pass, with
/// the sizes, before anything is downloaded: even when the user has agreed to
/// a large fetch.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn remote_fetch_refuses_up_front_a_set_larger_than_the_cache() {
    let remote = Remote::start().await;
    let budget = crate::remote_cache::budget();
    // Enough 3 GiB images to pass the budget whatever it is set to.
    let count = (budget / (3 << 30)) as usize + 1;
    let paths: Vec<PathBuf> = (0..count)
        .map(|n| remote.local(&format!("full/huge-{n}/sub-01/same_item.nii")))
        .collect();
    let small = remote.local("full/sub-02/same_item.nii");
    let mut members: Vec<(&str, &Path)> = paths
        .iter()
        .map(|path| ("sub-01", path.as_path()))
        .collect();
    members.push(("sub-02", small.as_path()));
    for allow_large in [false, true] {
        let (result, reports) = run_fetch(&remote, sources(&members), allow_large).await;
        let error = result.unwrap_err();
        let crate::BridgeError::Io { code, details } = &error else {
            panic!("{error:?}");
        };
        assert_eq!(*code, fetch::CODE_CACHE_FULL, "{details}");
        assert!(
            details.starts_with(&format!(
                "These images need {:.1} GB from 127.0.0.1, ",
                (count * 3) as f64
            )) && details.contains("Nothing was fetched."),
            "{details}"
        );
        assert!(reports.is_empty());
    }
    assert!(
        pop_reads("/popset/full/").is_empty(),
        "nothing is downloaded"
    );
    assert!(!small.exists());

    // The rule itself: what connected folders hold cannot be evicted, so it
    // counts against the budget with the bytes to fetch.
    assert!(fetch::over_budget(60, 40, 100, "host").is_none());
    let crate::BridgeError::Io { code, details } =
        fetch::over_budget(3 << 30, 2 << 30, 4 << 30, "host").unwrap()
    else {
        panic!("an I/O refusal");
    };
    assert_eq!(code, fetch::CODE_CACHE_FULL);
    assert_eq!(
        details,
        "These images need 3.0 GB from host, but the remote cache may hold 4.0 GB and connected folders already use 2.0 GB of it. Nothing was fetched. Unmount a remote folder you are not using and purge its cache, or raise BRAINFLOW_REMOTE_CACHE_BYTES."
    );
    let crate::BridgeError::Io { details, .. } =
        fetch::over_budget(5 << 30, 0, 4 << 30, "host").unwrap()
    else {
        panic!("an I/O refusal");
    };
    assert!(
        details.starts_with(
            "These images need 5.0 GB from host, more than the 4.0 GB the remote cache may hold."
        ),
        "{details}"
    );

    remote.finish().await;
}

/// Cancel does not wait for cache admission, evicts and downloads nothing
/// afterwards, and never stops a transfer of the same file that another
/// caller (an interactive open) started.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn remote_fetch_cancel_is_prompt_at_admission_and_spares_another_callers_transfer() {
    let remote = Arc::new(Remote::start().await);
    let path = remote.local("admission/sub-01/same_item.nii");

    // An interactive open of the same file is in flight: it holds cache
    // admission and has registered its transfer on the mount.
    let admission = crate::remote_cache::ADMISSION.lock().await;
    let (theirs, their_cancel) = remote.mount.transfers.begin(&path).unwrap();

    let request = StudioSourceFetchRequest {
        fetch_id: uuid::Uuid::new_v4().to_string(),
        sources: sources(&[("sub-01", &path)]),
        allow_large: false,
    };
    let (registration, cancel) = remote
        .state
        .studio_source_fetches
        .begin(&request.fetch_id)
        .unwrap();
    let fetch_id = request.fetch_id.clone();
    let downloading = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let worker = tokio::spawn({
        let remote = remote.clone();
        let downloading = downloading.clone();
        async move {
            let _registration = registration;
            fetch::fetch_sources(&remote.state, &request, cancel, &move |_| {
                downloading.store(true, Ordering::SeqCst)
            })
            .await
        }
    });
    tokio::time::timeout(Duration::from_secs(5), async {
        while !downloading.load(Ordering::SeqCst) {
            sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("the stat pass finishes and the download step begins");
    // It is now waiting for admission.
    sleep(Duration::from_millis(100)).await;
    assert!(!worker.is_finished());
    assert!(remote.state.studio_source_fetches.cancel(&fetch_id));
    let error = tokio::time::timeout(Duration::from_secs(2), worker)
        .await
        .expect("cancel does not wait for the admission lock")
        .unwrap()
        .unwrap_err();
    assert!(
        matches!(&error, crate::BridgeError::Input { code, .. } if *code == fetch::CODE_CANCELLED),
        "{error:?}"
    );
    assert!(
        !*their_cancel.borrow(),
        "the other caller's transfer of the same file is not cancelled"
    );
    assert!(pop_reads("/popset/admission/").is_empty());
    assert!(!path.exists());
    drop(theirs);
    drop(admission);

    // A fetch already stopped when it is admitted does nothing at all.
    let (stopped, already) = tokio::sync::watch::channel(true);
    let error = crate::materialize_remote_file_for(
        &remote.state,
        remote.mount.clone(),
        "/popset/admission/sub-01/same_item.nii".into(),
        &path,
        Some(already),
    )
    .await
    .unwrap_err();
    assert!(error.to_string().contains("cancelled"), "{error}");
    drop(stopped);
    assert!(pop_reads("/popset/admission/").is_empty());
    assert!(!path.exists());
    assert_eq!(
        remote.mount.op_semaphore.available_permits(),
        crate::REMOTE_MOUNT_MAX_CONCURRENT_OPS
    );

    Arc::try_unwrap(remote).ok().unwrap().finish().await;
}

/// The mount is registered but its session is down. Images already in the
/// cache are still usable and are reported as not re-checked; an image that
/// is not in the cache needs the folder.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn remote_fetch_uses_cached_images_when_the_session_is_down() {
    let remote = Remote::start().await;
    let first = remote.local("offline/sub-01/same_item.nii");
    let second = remote.local("offline/sub-02/same_item.nii");
    let never = remote.local("offline/sub-03/same_item.nii");
    let cached = [("sub-01", first.as_path()), ("sub-02", second.as_path())];
    let (result, _) = run_fetch(&remote, sources(&cached), false).await;
    let result = result.unwrap();
    assert_eq!((result.fetched_count, result.unverified_count), (2, 0));
    let read = pop_reads("/popset/offline/");

    remote.client.close().await.unwrap();

    let (result, reports) = run_fetch(&remote, sources(&cached), false).await;
    let result = result.unwrap();
    assert_eq!(result.status, StudioSourceFetchStatus::Ready);
    assert_eq!(
        (
            result.remote_count,
            result.fetch_count,
            result.fetched_count,
            result.unverified_count
        ),
        (2, 0, 0, 2)
    );
    assert!(reports.is_empty());
    // Population reads them as it would with the folder connected.
    let population = remote
        .state
        .population_slice
        .evaluate(
            population_request(&cached),
            &remote.state,
            crate::SampleCancellation::default(),
        )
        .await
        .unwrap();
    assert_eq!(population.unit_count, 2);

    // One image that was never fetched: the folder is needed.
    let with_uncached = [
        ("sub-01", first.as_path()),
        ("sub-02", second.as_path()),
        ("sub-03", never.as_path()),
    ];
    let (result, _) = run_fetch(&remote, sources(&with_uncached), false).await;
    let error = result.unwrap_err();
    assert!(
        matches!(&error, crate::BridgeError::Io { code, details }
            if *code == fetch::CODE_NOT_CONNECTED && details == fetch::NOT_CONNECTED),
        "{error:?}"
    );
    // A cached file without its sidecar is not vouched for either.
    let sidecar = crate::remote_cache_metadata_path(&remote.mount, &second).unwrap();
    std::fs::remove_file(&sidecar).unwrap();
    let (result, _) = run_fetch(&remote, sources(&cached), false).await;
    let error = result.unwrap_err();
    assert!(
        matches!(&error, crate::BridgeError::Io { code, .. } if *code == fetch::CODE_NOT_CONNECTED),
        "{error:?}"
    );
    assert_eq!(
        pop_reads("/popset/offline/"),
        read,
        "nothing is read offline"
    );

    remote.finish().await;
}

/// A fetch belongs to the mount it began on. When that mount is replaced
/// mid-fetch it stops, publishes nothing more, and says to reconnect; so does
/// a path whose mount is gone.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn remote_fetch_refuses_a_replaced_or_absent_mount() {
    let remote = Arc::new(Remote::start().await);
    let slow = remote.local("replaced/sub-01-slow/same_item.nii");
    let next = remote.local("replaced/sub-02/same_item.nii");
    let request = StudioSourceFetchRequest {
        fetch_id: uuid::Uuid::new_v4().to_string(),
        sources: sources(&[("sub-01", &slow), ("sub-02", &next)]),
        allow_large: false,
    };
    let (registration, cancel) = remote
        .state
        .studio_source_fetches
        .begin(&request.fetch_id)
        .unwrap();
    let worker = tokio::spawn({
        let remote = remote.clone();
        async move {
            let _registration = registration;
            fetch::fetch_sources(&remote.state, &request, cancel, &|_| {}).await
        }
    });
    tokio::time::timeout(Duration::from_secs(5), async {
        while pop_reads("/popset/replaced/").is_empty() {
            sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("the download starts");
    // Reconnecting: the old mount stops, and a new one serves the same folder.
    let replacement = crate::RemoteMountEntry {
        mount_id: "replacement".into(),
        op_semaphore: Arc::new(tokio::sync::Semaphore::new(
            crate::REMOTE_MOUNT_MAX_CONCURRENT_OPS,
        )),
        transfers: Arc::new(crate::remote_transfer::Control::default()),
        ..remote.mount.clone()
    };
    {
        let mut mounts = remote.state.remote_mounts.lock().await;
        mounts.remove("fixture");
        remote.mount.transfers.stop();
        mounts.insert("replacement".into(), replacement.clone());
    }
    let error = worker.await.unwrap().unwrap_err();
    assert!(
        matches!(&error, crate::BridgeError::Io { code, details }
            if *code == fetch::CODE_NOT_CONNECTED && details == fetch::NOT_CONNECTED),
        "{error:?}"
    );
    assert!(!slow.exists());
    assert!(
        !next.exists(),
        "the replaced mount's fetch does not continue"
    );
    assert_eq!(staging_left(slow.parent().unwrap()), Vec::<String>::new());
    assert_eq!(
        remote.mount.op_semaphore.available_permits(),
        crate::REMOTE_MOUNT_MAX_CONCURRENT_OPS
    );

    // The replacement is an ordinary mount: a new fetch runs on it.
    let (result, _) = run_fetch(&remote, sources(&[("sub-02", &next)]), false).await;
    assert_eq!(result.unwrap().fetched_count, 1);
    assert!(next.exists());

    // A cache path no mount serves: the folder is not connected.
    let orphan = crate::remote_cache_root()
        .unwrap()
        .join(format!("cache-test-{}", uuid::Uuid::new_v4()))
        .join("sub-01/same_item.nii");
    let (result, _) = run_fetch(&remote, sources(&[("sub-01", &orphan)]), false).await;
    let error = result.unwrap_err();
    assert!(
        matches!(&error, crate::BridgeError::Io { code, .. } if *code == fetch::CODE_NOT_CONNECTED),
        "{error:?}"
    );
    let error = fetch::require_local(&remote.state, &orphan)
        .await
        .unwrap_err();
    assert_eq!(
        error.to_string(),
        format!("I/O Error: {}", fetch::NOT_CONNECTED)
    );

    replacement.transfers.stop();
    Arc::try_unwrap(remote).ok().unwrap().finish().await;
}
