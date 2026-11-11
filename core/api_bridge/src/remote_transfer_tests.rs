//! Fixture adapted from remotely tests/sftp_concurrency.rs at ea3732a.
//! End-to-end coverage for the SFTP channel-reuse change: many concurrent
//! filesystem operations on one `RemoteClient` must multiplex over a SINGLE
//! shared SFTP channel rather than each opening their own (the behaviour that
//! previously exhausted the SSH session and surfaced as "Channel send error").
//!
//! Uses a real in-memory russh + russh-sftp server so the operations actually
//! succeed, and counts server-side channel opens to prove the reuse.

use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use russh::keys::PrivateKey;
use russh::server::{
    self, Auth, ChannelOpenHandle, Config, Msg, RunningServerHandle, Server as _, Session,
};
use russh::{Channel, ChannelId};
use russh_sftp::protocol::{
    Attrs, Data, File, FileAttributes, Handle, Name, OpenFlags, Status, StatusCode,
};
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio::time::sleep;

use crate::bids_index::remote::RemoteKind;
use remotely::ssh::AuthMethod;
use remotely::{ConnectConfig, RemoteClient};

/// A gzipped NIfTI-1 file whose voxels do not compress, served for `*.nii.gz`.
static GZ_IMAGE: LazyLock<Vec<u8>> = LazyLock::new(|| {
    use std::io::Write;
    let mut header = [0u8; 348];
    header[0..4].copy_from_slice(&348i32.to_le_bytes());
    for (i, dim) in [4i16, 8, 8, 4, 12].iter().enumerate() {
        header[40 + 2 * i..42 + 2 * i].copy_from_slice(&dim.to_le_bytes());
    }
    header[70..72].copy_from_slice(&16i16.to_le_bytes());
    header[72..74].copy_from_slice(&32i16.to_le_bytes());
    header[344..348].copy_from_slice(b"n+1\0");
    let mut state = 0x9e37_79b9u32;
    let noise: Vec<u8> = (0..4u32 << 20)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            state as u8
        })
        .collect();
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
    encoder.write_all(&header).unwrap();
    encoder.write_all(&noise).unwrap();
    encoder.finish().unwrap()
});
static GZ_BYTES_SERVED: AtomicU64 = AtomicU64::new(0);

/// A gzipped 3D NIfTI-1 file of `dims`, 2 mm isotropic, with a megabyte of
/// voxels that do not compress.
fn gz_volume(dims: [i16; 3]) -> Vec<u8> {
    use std::io::Write;
    let mut header = [0u8; 348];
    header[0..4].copy_from_slice(&348i32.to_le_bytes());
    for (i, dim) in [3i16, dims[0], dims[1], dims[2]].iter().enumerate() {
        header[40 + 2 * i..42 + 2 * i].copy_from_slice(&dim.to_le_bytes());
    }
    header[70..72].copy_from_slice(&16i16.to_le_bytes());
    header[72..74].copy_from_slice(&32i16.to_le_bytes());
    for i in 1..=3 {
        header[76 + 4 * i..80 + 4 * i].copy_from_slice(&2.0f32.to_le_bytes());
    }
    header[344..348].copy_from_slice(b"n+1\0");
    let mut state = 0x9e37_79b9u32;
    let noise: Vec<u8> = (0..1u32 << 20)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            state as u8
        })
        .collect();
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
    encoder.write_all(&header).unwrap();
    encoder.write_all(&noise).unwrap();
    encoder.finish().unwrap()
}

/// Files under `/audit/<scenario>/`: an image set for the Set studio header
/// audit. `odd` in a name puts that file on another grid.
static AUDIT_IMAGE: LazyLock<Vec<u8>> = LazyLock::new(|| gz_volume([8, 8, 4]));
static AUDIT_ODD_IMAGE: LazyLock<Vec<u8>> = LazyLock::new(|| gz_volume([8, 8, 5]));
const AUDIT_MODIFIED: u32 = 1_700_000_000;
/// Bytes of `/audit` images served. Only one test reads those files.
static AUDIT_BYTES_SERVED: AtomicU64 = AtomicU64::new(0);

/// Files of `/resume` opened for reading: valid images, the `slow` ones 30 ms
/// each. Only one test reads those files.
static RESUME_HEADER_READS: AtomicU64 = AtomicU64::new(0);

/// Files under `/popset/<test>/sub-0N/…`: small whole images the Set studio
/// reads together, every voxel of subject N holding N. `slow` in a path holds
/// its first read for 600 ms; `huge` reports a size above the fetch guard;
/// `missing` (any path) is absent. Each test uses its own `<test>` folder.
static POP_IMAGES: LazyLock<Vec<Vec<u8>>> = LazyLock::new(|| {
    (0..10u8)
        .map(|value| {
            let source =
                crate::set_sample_cache::TestSource::new(&[2, 2, 2], &[f32::from(value); 8]);
            std::fs::read(&source.path).unwrap()
        })
        .collect()
});
/// How often each `/popset` file was opened and read from its start.
static POP_READS: LazyLock<std::sync::Mutex<HashMap<String, usize>>> =
    LazyLock::new(Default::default);

fn pop_image(path: &str) -> &'static [u8] {
    let subject = path
        .split("sub-0")
        .nth(1)
        .and_then(|rest| rest.chars().next())
        .and_then(|digit| digit.to_digit(10))
        .unwrap_or(0);
    &POP_IMAGES[subject as usize]
}

fn pop_reads(prefix: &str) -> HashMap<String, usize> {
    POP_READS
        .lock()
        .unwrap()
        .iter()
        .filter(|(path, _)| path.starts_with(prefix))
        .map(|(path, count)| (path.clone(), *count))
        .collect()
}

fn audit_image(path: &str) -> &'static [u8] {
    if path.contains("odd") {
        &AUDIT_ODD_IMAGE
    } else {
        &AUDIT_IMAGE
    }
}

/// The files of one audit scenario directory.
fn audit_listing(scenario: &str) -> Vec<&'static str> {
    match scenario {
        "same" => vec![
            "sub-01_stat.nii.gz",
            "sub-02_stat.nii.gz",
            "sub-03_stat.nii.gz",
        ],
        "mixed" => vec![
            "sub-01_stat.nii.gz",
            "sub-02_odd_stat.nii.gz",
            "sub-03_stat.nii.gz",
        ],
        // `.nii` is served as bytes that are not a NIfTI header.
        "broken" => vec![
            "sub-01_stat.nii.gz",
            "sub-02_stat.nii",
            "sub-03_stat.nii.gz",
        ],
        _ => Vec::new(),
    }
}

/// The tree under `/cards`: a raw dataset with two derivative analyses, for
/// the dataset-card probes. `None` is a folder. Images are [`AUDIT_IMAGE`].
static CARDS_TREE: LazyLock<std::collections::BTreeMap<&'static str, Option<&'static [u8]>>> =
    LazyLock::new(|| {
        let image: &'static [u8] = &AUDIT_IMAGE;
        std::collections::BTreeMap::from([
            ("/cards", None),
            ("/cards/study", None),
            (
                "/cards/study/dataset_description.json",
                Some(&br#"{"Name": "Study", "DatasetType": "raw", "BIDSVersion": "1.9.0", "Lab": {"room": 4}}"#[..]),
            ),
            ("/cards/study/README", Some(&b"Remote readme"[..])),
            (
                "/cards/study/task-rest_bold.json",
                Some(&br#"{"RepetitionTime": 2.0, "EchoTime": 0.02}"#[..]),
            ),
            ("/cards/study/sub-01", None),
            ("/cards/study/sub-01/func", None),
            (
                "/cards/study/sub-01/func/sub-01_task-rest_bold.nii.gz",
                Some(image),
            ),
            (
                "/cards/study/sub-01/func/sub-01_task-rest_bold.json",
                Some(&br#"{"EchoTime": 0.03}"#[..]),
            ),
            ("/cards/study/derivatives", None),
            ("/cards/study/derivatives/glm", None),
            (
                "/cards/study/derivatives/glm/dataset_description.json",
                Some(&br#"{"Name": "GLM", "GeneratedBy": [{"Name": "fitlins", "Version": "0.11"}]}"#[..]),
            ),
            ("/cards/study/derivatives/glm/group", None),
            ("/cards/study/derivatives/glm/group/mean.nii.gz", Some(image)),
            ("/cards/study/derivatives/glm/sub-01", None),
            ("/cards/study/derivatives/glm/sub-01/maps", None),
            (
                "/cards/study/derivatives/glm/sub-01/maps/same_item.nii.gz",
                Some(image),
            ),
            ("/cards/study/derivatives/bare", None),
            ("/cards/study/derivatives/bare/sub-01", None),
            ("/cards/study/derivatives/bare/sub-01/x.nii.gz", Some(image)),
            // A plain folder of analyses, with no `derivatives` to announce it.
            ("/cards/pile", None),
            ("/cards/pile/one", None),
            ("/cards/pile/one/sub-01", None),
            ("/cards/pile/two", None),
            ("/cards/pile/two/sub-01", None),
        ])
    });
/// Bytes of `/cards` images served, and reads of any `/cards` file.
static CARDS_IMAGE_BYTES_SERVED: AtomicU64 = AtomicU64::new(0);
static CARDS_READS: AtomicU64 = AtomicU64::new(0);

fn cards_attrs(path: &str) -> Option<FileAttributes> {
    let entry = CARDS_TREE.get(path)?;
    Some(FileAttributes {
        size: Some(entry.map_or(0, |bytes| bytes.len() as u64)),
        permissions: Some(if entry.is_some() {
            0o100_644
        } else {
            0o040_755
        }),
        mtime: Some(AUDIT_MODIFIED),
        ..Default::default()
    })
}

// ---- mock SSH server that exposes a minimal SFTP subsystem ----

#[derive(Clone)]
struct SftpServer {
    channel_opens: Arc<AtomicUsize>,
    sftp_subsystems: Arc<AtomicUsize>,
}

impl server::Server for SftpServer {
    type Handler = SftpSshSession;

    fn new_client(&mut self, _: Option<SocketAddr>) -> Self::Handler {
        SftpSshSession {
            channels: Arc::new(Mutex::new(HashMap::new())),
            channel_opens: Arc::clone(&self.channel_opens),
            sftp_subsystems: Arc::clone(&self.sftp_subsystems),
        }
    }
}

struct SftpSshSession {
    channels: Arc<Mutex<HashMap<ChannelId, Channel<Msg>>>>,
    channel_opens: Arc<AtomicUsize>,
    sftp_subsystems: Arc<AtomicUsize>,
}

impl server::Handler for SftpSshSession {
    type Error = russh::Error;

    async fn auth_password(&mut self, _user: &str, _password: &str) -> Result<Auth, Self::Error> {
        Ok(Auth::Accept)
    }

    async fn channel_open_session(
        &mut self,
        channel: Channel<Msg>,
        reply: ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.channel_opens.fetch_add(1, Ordering::SeqCst);
        self.channels.lock().await.insert(channel.id(), channel);
        reply.accept().await;
        Ok(())
    }

    async fn subsystem_request(
        &mut self,
        channel_id: ChannelId,
        name: &str,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        if name == "sftp" {
            self.sftp_subsystems.fetch_add(1, Ordering::SeqCst);
            let channel = self.channels.lock().await.remove(&channel_id).unwrap();
            session.channel_success(channel_id)?;
            russh_sftp::server::run(channel.into_stream(), SftpHandler::default()).await;
        } else {
            session.channel_failure(channel_id)?;
        }
        Ok(())
    }
}

/// Minimal SFTP backend: a single directory with two regular files. russh-sftp
/// processes requests on a session serially, so `&mut self` state is race-free
/// even though the client has many requests in flight over the one channel.
#[derive(Default)]
struct SftpHandler {
    next_handle: AtomicU64,
    dir_read_done: HashSet<String>,
}

impl SftpHandler {
    fn file_attrs() -> FileAttributes {
        FileAttributes {
            size: Some(1024 * 1024),
            permissions: Some(0o100_644),
            ..Default::default()
        }
    }
}

impl russh_sftp::server::Handler for SftpHandler {
    type Error = StatusCode;

    fn unimplemented(&self) -> Self::Error {
        StatusCode::OpUnsupported
    }

    async fn open(
        &mut self,
        id: u32,
        path: String,
        _flags: OpenFlags,
        _attrs: FileAttributes,
    ) -> Result<Handle, Self::Error> {
        if path.starts_with("/cards") {
            return match CARDS_TREE.get(path.as_str()) {
                Some(Some(_)) => Ok(Handle {
                    id,
                    handle: format!("cards:{path}"),
                }),
                _ => Err(StatusCode::NoSuchFile),
            };
        }
        let handle = if path.starts_with("/popset/") {
            format!("pop:{path}")
        } else if path.starts_with("/resume/") && path.ends_with(".nii.gz") {
            format!("resume:{path}")
        } else if path.starts_with("/audit/") && path.ends_with(".nii.gz") {
            format!("audit:{path}")
        } else if path.ends_with(".nii.gz") {
            "gz".to_string()
        } else {
            "file".to_string()
        };
        Ok(Handle { id, handle })
    }
    async fn read(
        &mut self,
        id: u32,
        handle: String,
        offset: u64,
        len: u32,
    ) -> Result<Data, Self::Error> {
        if let Some(path) = handle.strip_prefix("cards:") {
            let bytes = CARDS_TREE[path].unwrap_or_default();
            let start = offset as usize;
            if start >= bytes.len() {
                return Err(StatusCode::Eof);
            }
            // Slow enough that a card is still being read when a test acts.
            if offset == 0 {
                CARDS_READS.fetch_add(1, Ordering::SeqCst);
                sleep(Duration::from_millis(40)).await;
            }
            let end = (start + len as usize).min(bytes.len());
            if path.ends_with(".nii.gz") {
                CARDS_IMAGE_BYTES_SERVED.fetch_add((end - start) as u64, Ordering::SeqCst);
            }
            return Ok(Data {
                id,
                data: bytes[start..end].to_vec(),
            });
        }
        if let Some(path) = handle.strip_prefix("pop:") {
            let image = pop_image(path);
            let start = offset as usize;
            if start >= image.len() {
                return Err(StatusCode::Eof);
            }
            if offset == 0 {
                *POP_READS
                    .lock()
                    .unwrap()
                    .entry(path.to_string())
                    .or_default() += 1;
                if path.contains("slow") {
                    sleep(Duration::from_millis(600)).await;
                }
            }
            let end = (start + len as usize).min(image.len());
            return Ok(Data {
                id,
                data: image[start..end].to_vec(),
            });
        }
        if let Some(path) = handle.strip_prefix("resume:") {
            let image: &'static [u8] = &AUDIT_IMAGE;
            let start = offset as usize;
            if start >= image.len() {
                return Err(StatusCode::Eof);
            }
            if offset == 0 {
                RESUME_HEADER_READS.fetch_add(1, Ordering::SeqCst);
                if path.contains("slow") {
                    sleep(Duration::from_millis(30)).await;
                }
            }
            let end = (start + len as usize).min(image.len());
            return Ok(Data {
                id,
                data: image[start..end].to_vec(),
            });
        }
        if let Some(path) = handle.strip_prefix("audit:") {
            let image = audit_image(path);
            let start = offset as usize;
            if start >= image.len() {
                return Err(StatusCode::Eof);
            }
            let end = (start + len as usize).min(image.len());
            AUDIT_BYTES_SERVED.fetch_add((end - start) as u64, Ordering::SeqCst);
            return Ok(Data {
                id,
                data: image[start..end].to_vec(),
            });
        }
        if handle == "gz" {
            let start = offset as usize;
            if start >= GZ_IMAGE.len() {
                return Err(StatusCode::Eof);
            }
            let end = (start + len as usize).min(GZ_IMAGE.len());
            GZ_BYTES_SERVED.fetch_add((end - start) as u64, Ordering::SeqCst);
            return Ok(Data {
                id,
                data: GZ_IMAGE[start..end].to_vec(),
            });
        }
        sleep(Duration::from_millis(30)).await;
        if offset >= 1024 * 1024 {
            return Err(StatusCode::Eof);
        }
        let len = (len as usize).min(1024 * 1024 - offset as usize).min(65536);
        Ok(Data {
            id,
            data: vec![42; len],
        })
    }
    async fn realpath(&mut self, id: u32, path: String) -> Result<Name, Self::Error> {
        let resolved = if path == "." { "/".to_string() } else { path };
        Ok(Name {
            id,
            files: vec![File::dummy(resolved)],
        })
    }

    async fn opendir(&mut self, id: u32, path: String) -> Result<Handle, Self::Error> {
        // Hand out a unique handle per open so concurrent listings of the same
        // directory don't share read-EOF state.
        let n = self.next_handle.fetch_add(1, Ordering::SeqCst);
        if path.starts_with("/cards") {
            return match CARDS_TREE.get(path.as_str()) {
                Some(None) => Ok(Handle {
                    id,
                    handle: format!("cards-dir:{path}:{n}"),
                }),
                _ => Err(StatusCode::NoSuchFile),
            };
        }
        let handle = match path.strip_prefix("/audit/") {
            Some(scenario) => format!("audit-dir:{scenario}:{n}"),
            None => format!("dir-{n}"),
        };
        Ok(Handle { id, handle })
    }

    async fn readdir(&mut self, id: u32, handle: String) -> Result<Name, Self::Error> {
        if self.dir_read_done.contains(&handle) {
            return Err(StatusCode::Eof);
        }
        self.dir_read_done.insert(handle.clone());
        if let Some(rest) = handle.strip_prefix("cards-dir:") {
            let dir = rest.rsplit_once(':').map_or(rest, |(dir, _)| dir);
            let prefix = format!("{dir}/");
            return Ok(Name {
                id,
                files: CARDS_TREE
                    .keys()
                    .filter_map(|path| path.strip_prefix(prefix.as_str()))
                    .filter(|name| !name.contains('/'))
                    .map(|name| File::new(name, cards_attrs(&format!("{prefix}{name}")).unwrap()))
                    .collect(),
            });
        }
        if let Some(rest) = handle.strip_prefix("audit-dir:") {
            let scenario = rest.split(':').next().unwrap_or_default();
            return Ok(Name {
                id,
                files: audit_listing(scenario)
                    .into_iter()
                    .map(|name| {
                        File::new(
                            name,
                            FileAttributes {
                                size: Some(audit_image(name).len() as u64),
                                mtime: Some(AUDIT_MODIFIED),
                                ..Self::file_attrs()
                            },
                        )
                    })
                    .collect(),
            });
        }
        Ok(Name {
            id,
            files: vec![
                File::new("alpha.nii", Self::file_attrs()),
                File::new("beta.nii", Self::file_attrs()),
            ],
        })
    }

    async fn close(&mut self, id: u32, _handle: String) -> Result<Status, Self::Error> {
        Ok(Status {
            id,
            status_code: StatusCode::Ok,
            error_message: "Ok".to_string(),
            language_tag: "en-US".to_string(),
        })
    }

    async fn stat(&mut self, id: u32, path: String) -> Result<Attrs, Self::Error> {
        if path.contains("missing") {
            return Err(StatusCode::NoSuchFile);
        }
        if path.starts_with("/cards") {
            return cards_attrs(&path)
                .map(|attrs| Attrs { id, attrs })
                .ok_or(StatusCode::NoSuchFile);
        }
        if path.starts_with("/popset/") {
            return Ok(Attrs {
                id,
                attrs: FileAttributes {
                    size: Some(if path.contains("huge") {
                        3 << 30
                    } else {
                        pop_image(&path).len() as u64
                    }),
                    mtime: Some(AUDIT_MODIFIED),
                    ..Self::file_attrs()
                },
            });
        }
        Ok(Attrs {
            id,
            attrs: Self::file_attrs(),
        })
    }

    async fn lstat(&mut self, id: u32, path: String) -> Result<Attrs, Self::Error> {
        self.stat(id, path).await
    }

    async fn fstat(&mut self, id: u32, _handle: String) -> Result<Attrs, Self::Error> {
        self.stat(id, String::new()).await
    }
}

struct StartedSftpServer {
    addr: SocketAddr,
    shutdown: RunningServerHandle,
    join: JoinHandle<std::io::Result<()>>,
}

async fn spawn_sftp_server(
    host_key: PrivateKey,
    channel_opens: Arc<AtomicUsize>,
    sftp_subsystems: Arc<AtomicUsize>,
) -> StartedSftpServer {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let addr = listener.local_addr().unwrap();

    let config = Arc::new(Config {
        auth_rejection_time: Duration::from_millis(25),
        auth_rejection_time_initial: Some(Duration::from_millis(0)),
        keys: vec![host_key],
        ..Default::default()
    });

    let (tx, rx) = tokio::sync::oneshot::channel();
    let join = tokio::spawn(async move {
        let mut server = SftpServer {
            channel_opens,
            sftp_subsystems,
        };
        let running = server.run_on_socket(config, &listener);
        let shutdown = running.handle();
        let _ = tx.send(shutdown);
        running.await
    });
    let shutdown = rx.await.unwrap();

    for _ in 0..50 {
        if tokio::net::TcpStream::connect(addr).await.is_ok() {
            break;
        }
        sleep(Duration::from_millis(10)).await;
    }

    StartedSftpServer {
        addr,
        shutdown,
        join,
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn remote_transfer_real_sftp_success_cancel_stall_and_retry() {
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
    let root = std::env::temp_dir().join(format!("brainflow-sftp-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    let cleanup = super::Staging(root.clone());
    let count = Arc::new(AtomicU64::new(0));
    let progress_count = count.clone();
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
        op_semaphore: Arc::new(tokio::sync::Semaphore::new(1)),
        transfers: Arc::new(super::Control::default()),
        progress: Arc::new(move |progress| {
            progress_count.store(progress.bytes_downloaded, Ordering::SeqCst);
        }),
    };
    let destination = root.join("image.nii");
    super::download_owned(
        mount.clone(),
        "/image.nii".into(),
        destination.clone(),
        1024 * 1024,
        Duration::from_secs(2),
    )
    .await
    .unwrap();
    assert_eq!(std::fs::read(&destination).unwrap(), vec![42; 1024 * 1024]);
    assert_eq!(count.load(Ordering::SeqCst), 1024 * 1024);
    std::fs::remove_file(&destination).unwrap();
    count.store(0, Ordering::SeqCst);
    let work = tokio::spawn(super::download_owned(
        mount.clone(),
        "/image.nii".into(),
        destination.clone(),
        1024 * 1024,
        Duration::from_secs(2),
    ));
    tokio::time::timeout(Duration::from_secs(3), async {
        while count.load(Ordering::SeqCst) == 0 {
            sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    assert!(mount.transfers.cancel(&destination));
    assert!(work
        .await
        .unwrap()
        .unwrap_err()
        .to_string()
        .contains("cancelled"));
    assert!(!destination.exists());
    assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
    assert_eq!(mount.op_semaphore.available_permits(), 1);
    let stalled = super::download_owned(
        mount.clone(),
        "/image.nii".into(),
        destination.clone(),
        1024 * 1024,
        Duration::from_millis(10),
    )
    .await;
    assert!(stalled.unwrap_err().to_string().contains("stalled"));
    assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
    super::download_owned(
        mount.clone(),
        "/image.nii".into(),
        destination.clone(),
        1024 * 1024,
        Duration::from_secs(2),
    )
    .await
    .unwrap();
    assert_eq!(std::fs::metadata(&destination).unwrap().len(), 1024 * 1024);
    mount.transfers.stop();
    client.close().await.unwrap();
    server.shutdown.shutdown("done".into());
    server.join.await.unwrap().unwrap();
    drop(cleanup);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn remote_headers_stream_only_the_start_of_gzipped_files() {
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
    let mount = crate::RemoteMountEntry {
        mount_id: "fixture".into(),
        local_root: std::env::temp_dir(),
        remote_root: "/".into(),
        display_name: "fixture".into(),
        origin_label: "fixture".into(),
        host: "127.0.0.1".into(),
        connect_host: "127.0.0.1".into(),
        port: server.addr.port(),
        user: "fixture".into(),
        client: client.clone(),
        op_semaphore: Arc::new(tokio::sync::Semaphore::new(2)),
        transfers: Arc::new(super::Control::default()),
        progress: Arc::new(|_| {}),
    };
    let paths: Vec<String> = (0..6).map(|i| format!("/sub-0{i}_bold.nii.gz")).collect();
    let summaries = super::read_headers(&mount, &paths).await;
    assert_eq!(summaries.len(), paths.len());
    for summary in summaries {
        assert_eq!(summary.unwrap().dim, [8, 8, 4, 12]);
    }
    let served = GZ_BYTES_SERVED.load(Ordering::SeqCst);
    assert!(GZ_IMAGE.len() > 1 << 21);
    assert!(
        served <= 6 * 32 * 1024,
        "{served} bytes served for six headers"
    );
    assert_eq!(mount.op_semaphore.available_permits(), 2);
    let listed = super::list_directories(&mount, &["/".to_string(), "/sub-01".to_string()]).await;
    assert_eq!(listed.len(), 2);
    for directory in listed {
        let names: Vec<(String, RemoteKind, u64)> = directory
            .unwrap()
            .into_iter()
            .map(|entry| (entry.name, entry.kind, entry.size))
            .collect();
        assert_eq!(
            names,
            [
                ("alpha.nii".to_string(), RemoteKind::File, 1024 * 1024),
                ("beta.nii".to_string(), RemoteKind::File, 1024 * 1024),
            ]
        );
    }
    let fetched = super::read_files(
        &mount,
        &["/alpha.nii".to_string(), "/beta.nii".to_string()],
        1024 * 1024,
    )
    .await;
    assert_eq!(fetched[0].as_ref().unwrap(), &vec![42; 1024 * 1024]);
    assert_eq!(fetched[1].as_ref().unwrap().len(), 1024 * 1024);
    let capped = super::read_files(&mount, &["/alpha.nii".to_string()], 1024).await;
    assert!(capped[0]
        .as_ref()
        .unwrap_err()
        .to_string()
        .contains("larger"));
    assert_eq!(mount.op_semaphore.available_permits(), 2);
    mount.transfers.stop();
    assert!(super::read_headers(&mount, &paths[..1]).await[0].is_err());
    assert!(super::list_directories(&mount, &["/".to_string()]).await[0].is_err());
    assert!(super::read_files(&mount, &["/alpha.nii".to_string()], 1024).await[0].is_err());
    client.close().await.unwrap();
    server.shutdown.shutdown("done".into());
    server.join.await.unwrap().unwrap();
}

/// A BIDS root file may be absent from the server (participants.tsv is only
/// recommended; a dataset opened by layout has no description). Only that
/// absence is tolerated: a transport failure or a stopped mount is an error,
/// never a missing file that would send a valid dataset down the layout walk.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn optional_remote_files_tolerate_only_absence() {
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
    let root = std::env::temp_dir().join(format!("brainflow-sftp-bids-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    let cleanup = super::Staging(root.clone());
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
        op_semaphore: Arc::new(tokio::sync::Semaphore::new(1)),
        transfers: Arc::new(super::Control::default()),
        progress: Arc::new(|_| {}),
    };
    let state = crate::BridgeState::default().unwrap();
    state
        .remote_mounts
        .lock()
        .await
        .insert("fixture".into(), mount.clone());

    let missing = root.join("missing-participants.tsv");
    assert!(!crate::materialize_optional_remote_file(&state, &missing)
        .await
        .expect("an absent remote file is not an error"));
    let description = root.join("dataset_description.json");
    assert!(
        crate::materialize_optional_remote_file(&state, &description)
            .await
            .unwrap()
    );
    assert!(description.exists(), "a present file is materialized");

    // The connection is gone: a transport failure, not an absent file.
    client.close().await.unwrap();
    let error = crate::materialize_optional_remote_file(&state, &root.join("participants.tsv"))
        .await
        .expect_err("a transport failure propagates");
    assert!(!error.to_string().is_empty());

    // A stopped mount refuses before any transfer.
    mount.transfers.stop();
    let error = crate::materialize_optional_remote_file(&state, &missing)
        .await
        .expect_err("a stopped mount propagates, even for an absent file");
    assert!(error.to_string().contains("unmounted"), "{error}");

    server.shutdown.shutdown("done".into());
    let _ = server.join.await;
    drop(cleanup);
}

/// A second folder on a host that is already mounted reuses the live, signed-in
/// session (no second password or 2FA prompt); the same folder is handed back
/// as-is; another account or a closed session never borrows it.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn remote_mounts_share_a_live_session_per_endpoint() {
    let server = spawn_sftp_server(
        PrivateKey::random(&mut rand::rng(), russh::keys::Algorithm::Ed25519).unwrap(),
        Arc::new(AtomicUsize::new(0)),
        Arc::new(AtomicUsize::new(0)),
    )
    .await;
    let port = server.addr.port();
    let config = ConnectConfig::new(server.addr.ip().to_string(), "fixture")
        .port(port)
        .auth(AuthMethod::Password("ephemeral-test-only".into()))
        .connect_timeout(Duration::from_secs(5))
        .operation_timeout(Duration::from_secs(5))
        .retry_count(0)
        .skip_host_key_verification();
    let client = Arc::new(RemoteClient::connect(config).await.unwrap());
    let root = std::env::temp_dir().join(format!("brainflow-share-test-{}", uuid::Uuid::new_v4()));
    let local_root = root.join(crate::remote_cache::identity(
        "127.0.0.1",
        port,
        "fixture",
        "/data",
    ));
    std::fs::create_dir_all(&local_root).unwrap();
    let cleanup = super::Staging(root.clone());

    let state = crate::BridgeState::default().unwrap();
    state.remote_mounts.lock().await.insert(
        "first".into(),
        crate::RemoteMountEntry {
            mount_id: "first".into(),
            local_root,
            remote_root: "/data".into(),
            display_name: "fixture".into(),
            origin_label: "fixture".into(),
            host: "127.0.0.1".into(),
            connect_host: "127.0.0.1".into(),
            port,
            user: "fixture".into(),
            client: client.clone(),
            op_semaphore: Arc::new(tokio::sync::Semaphore::new(1)),
            transfers: Arc::new(super::Control::default()),
            progress: Arc::new(|_| {}),
        },
    );

    let no_config = remotely::ssh::SshConfig::default();
    let request = |user: &str, path: &str| {
        crate::normalize_remote_mount_request(
            bridge_types::RemoteMountConnectRequest {
                host: "127.0.0.1".into(),
                port: Some(port),
                user: user.into(),
                remote_path: path.into(),
                auth_method: Some("password".into()),
                password: None,
                key_path: None,
                key_passphrase: None,
                verify_host_key: None,
                accept_unknown_host_keys: None,
                known_hosts_path: None,
                remember_password: None,
                save_profile: None,
                profile_name: None,
                reconnect_on_launch: None,
            },
            &no_config,
        )
        .unwrap()
    };

    let same = request("fixture", "/data/");
    let info = crate::live_remote_mount_for_request(&state, &same)
        .await
        .expect("the mounted folder is returned without a login");
    assert_eq!(info.mount_id, "first");

    let other_folder = request("fixture", "/other");
    assert!(crate::live_remote_mount_for_request(&state, &other_folder)
        .await
        .is_none());
    let shared = crate::shared_remote_client_for_request(&state, &other_folder)
        .await
        .expect("same endpoint shares the session");
    assert!(Arc::ptr_eq(&shared, &client));

    let other_user = request("someone-else", "/other");
    assert!(crate::shared_remote_client_for_request(&state, &other_user)
        .await
        .is_none());

    client.close().await.unwrap();
    assert!(
        crate::shared_remote_client_for_request(&state, &other_folder)
            .await
            .is_none()
    );
    assert!(crate::live_remote_mount_for_request(&state, &same)
        .await
        .is_none());
    drop(cleanup);
}

fn fixture_config(server: &StartedSftpServer) -> ConnectConfig {
    ConnectConfig::new(server.addr.ip().to_string(), "fixture")
        .port(server.addr.port())
        .auth(AuthMethod::Password("ephemeral-test-only".into()))
        .connect_timeout(Duration::from_secs(5))
        .operation_timeout(Duration::from_secs(5))
        .retry_count(0)
        .skip_host_key_verification()
}

fn fixture_mount_request(port: u16, remote_path: &str) -> crate::NormalizedRemoteMountRequest {
    crate::normalize_remote_mount_request(
        bridge_types::RemoteMountConnectRequest {
            host: "127.0.0.1".into(),
            port: Some(port),
            user: "fixture".into(),
            remote_path: remote_path.into(),
            auth_method: Some("password".into()),
            password: None,
            key_path: None,
            key_passphrase: None,
            verify_host_key: None,
            accept_unknown_host_keys: None,
            known_hosts_path: None,
            remember_password: None,
            save_profile: None,
            profile_name: None,
            reconnect_on_launch: None,
        },
        &remotely::ssh::SshConfig::default(),
    )
    .unwrap()
}

fn quiet_mount_hooks() -> crate::RemoteMountHooks {
    crate::RemoteMountHooks {
        progress: Arc::new(|_| {}),
        recovery: Box::new(|_, _, _| {}),
    }
}

fn connected_mount(
    result: bridge_types::RemoteMountConnectResult,
) -> bridge_types::RemoteMountInfo {
    match result {
        bridge_types::RemoteMountConnectResult::Connected { mount } => mount,
        _ => panic!("the mount was not registered"),
    }
}

/// A sign-in to a folder whose mount lost its session replaces that mount:
/// the new session serves the same cache folder and the cached files stay. A
/// mount whose session still answers is kept, and the spare session closed.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn remote_mount_sign_in_replaces_a_mount_whose_session_ended() {
    let server = spawn_sftp_server(
        PrivateKey::random(&mut rand::rng(), russh::keys::Algorithm::Ed25519).unwrap(),
        Arc::new(AtomicUsize::new(0)),
        Arc::new(AtomicUsize::new(0)),
    )
    .await;
    let port = server.addr.port();
    let cache_root =
        std::env::temp_dir().join(format!("brainflow-remount-test-{}", uuid::Uuid::new_v4()));
    let cleanup = super::Staging(cache_root.clone());
    let state = crate::BridgeState::default().unwrap();

    let first_client = Arc::new(
        RemoteClient::connect(fixture_config(&server))
            .await
            .unwrap(),
    );
    let first = connected_mount(
        crate::register_remote_mount(
            &state,
            fixture_mount_request(port, "/"),
            first_client.clone(),
            false,
            cache_root.clone(),
            quiet_mount_hooks(),
        )
        .await
        .unwrap(),
    );
    let local_root = std::path::PathBuf::from(&first.local_path);
    assert!(local_root.starts_with(&cache_root));
    let first_entry = state.remote_mounts.lock().await[&first.mount_id].clone();
    let cached = local_root.join("image.nii");
    super::download_owned(
        first_entry.clone(),
        "/image.nii".into(),
        cached.clone(),
        1024 * 1024,
        Duration::from_secs(2),
    )
    .await
    .unwrap();

    // While the session answers, a second sign-in is not needed: the mount is
    // returned as it is and the spare session is closed.
    let spare = Arc::new(
        RemoteClient::connect(fixture_config(&server))
            .await
            .unwrap(),
    );
    let kept = connected_mount(
        crate::register_remote_mount(
            &state,
            fixture_mount_request(port, "/"),
            spare.clone(),
            false,
            cache_root.clone(),
            quiet_mount_hooks(),
        )
        .await
        .unwrap(),
    );
    assert_eq!(kept.mount_id, first.mount_id);
    assert!(!spare.is_connected().await);
    assert!(first_client.is_connected().await);

    // The session drops. An operation says so with the code for it.
    first_client.close().await.unwrap();
    let lost = super::stat_owned(first_entry.clone(), "/image.nii".into())
        .await
        .unwrap_err();
    assert!(
        matches!(lost, crate::BridgeError::Io { code: 8266, .. }),
        "{lost:?}"
    );

    let second_client = Arc::new(
        RemoteClient::connect(fixture_config(&server))
            .await
            .unwrap(),
    );
    let second = connected_mount(
        crate::register_remote_mount(
            &state,
            fixture_mount_request(port, "/"),
            second_client.clone(),
            false,
            cache_root.clone(),
            quiet_mount_hooks(),
        )
        .await
        .unwrap(),
    );
    assert_ne!(second.mount_id, first.mount_id);
    assert_eq!(second.local_path, first.local_path);
    assert!(second_client.is_connected().await);
    {
        let mounts = state.remote_mounts.lock().await;
        assert_eq!(mounts.len(), 1);
        assert!(Arc::ptr_eq(
            &mounts[&second.mount_id].client,
            &second_client
        ));
    }
    // The old entry is retired as an unmount would: its transfers are stopped.
    assert!(first_entry.transfers.is_stopped());
    assert_eq!(
        std::fs::metadata(&cached).unwrap().len(),
        1024 * 1024,
        "the cached file is kept"
    );
    // The folder is served again, by the new session.
    let second_entry = state.remote_mounts.lock().await[&second.mount_id].clone();
    let stat = super::stat_owned(second_entry.clone(), "/image.nii".into())
        .await
        .unwrap();
    assert_eq!(stat.size, 1024 * 1024);

    second_entry.transfers.stop();
    second_client.close().await.unwrap();
    server.shutdown.shutdown("done".into());
    server.join.await.unwrap().unwrap();
    drop(cleanup);
}

/// Every way `remotely` says the session is gone gets the one code; a refused
/// login, a missing file and a slow answer on a live session keep theirs.
#[test]
fn remote_session_loss_has_one_code() {
    use remotely::error::{FsError, SshError};
    use remotely::Error;
    let context = |source: Error| Error::Context {
        message: "filesystem operation 'stat' on '/x'".into(),
        source: Box::new(source),
    };
    let channel = |reason: &str| Error::Ssh(SshError::ChannelError(reason.into()));
    let lost = [
        Error::Ssh(SshError::Disconnected),
        context(Error::Ssh(SshError::Disconnected)),
        context(context(Error::Ssh(SshError::Disconnected))),
        channel("SFTP transport error: session closed"),
        channel("SFTP transport error: sender dropped"),
        channel("SFTP transport error: Broken pipe (os error 32)"),
        channel("SFTP transport error: Connection reset by peer (os error 54)"),
        channel("SFTP transport error: unexpected end of file"),
        channel("failed to open channel: Disconnected"),
        context(channel("SFTP transport error: session closed")),
        Error::Ssh(SshError::Protocol(
            "Connection closed by the remote side".into(),
        )),
    ];
    for err in lost {
        let text = err.to_string();
        let mapped = crate::map_remotely_error(err, 8243);
        match mapped {
            crate::BridgeError::Io { code, details } => {
                assert_eq!(code, crate::REMOTE_SESSION_LOST_CODE, "{text}");
                // The transport's own sentence stays readable.
                assert_eq!(details, text);
            }
            other => panic!("{text}: {other:?}"),
        }
    }
    // Whatever operation found out.
    for code in [8216, 8218, 8229, 8243] {
        let mapped = crate::map_remotely_error(Error::Ssh(SshError::Disconnected), code);
        assert!(
            matches!(mapped, crate::BridgeError::Io { code: 8266, .. }),
            "{code}: {mapped:?}"
        );
    }
    assert_eq!(
        crate::map_remotely_error(Error::Ssh(SshError::Disconnected), 8218).to_string(),
        "I/O Error: SSH error: SSH session disconnected"
    );

    let kept = [
        Error::Ssh(SshError::AuthDenied {
            user: "fixture".into(),
            remaining_methods: vec!["password".into()],
            partial_success: false,
        }),
        Error::Ssh(SshError::AuthenticationFailed {
            user: "fixture".into(),
            reason: "disconnected by the server".into(),
        }),
        Error::Ssh(SshError::ConnectionTimeout {
            host: "host".into(),
            port: 22,
        }),
        channel("SFTP request timed out"),
        channel("failed to open channel: Channel send error"),
        channel("unexpected SFTP packet"),
        Error::Fs(FsError::NotFound {
            path: "/scratch/session closed.nii".into(),
        }),
        context(Error::Fs(FsError::NotFound {
            path: "/scratch/x.nii".into(),
        })),
        Error::Fs(FsError::PermissionDenied {
            path: "/scratch/x.nii".into(),
        }),
        Error::Fs(FsError::SftpError("Failure on /x: broken pipe".into())),
    ];
    for err in kept {
        let text = err.to_string();
        let mapped = crate::map_remotely_error(err, 8243);
        let code = match &mapped {
            crate::BridgeError::Io { code, .. }
            | crate::BridgeError::Input { code, .. }
            | crate::BridgeError::Internal { code, .. }
            | crate::BridgeError::Scope { code, .. } => *code,
            other => panic!("{text}: {other:?}"),
        };
        assert_eq!(code, 8243, "{text}");
    }
    // A sign-in the server hung up on never had a session to lose.
    assert!(matches!(
        crate::map_remotely_error(Error::Ssh(SshError::Disconnected), 8221),
        crate::BridgeError::Io { code: 8221, .. }
    ));
}

fn audit_request(root: &std::path::Path) -> bridge_types::StudioImportPreviewRequest {
    bridge_types::StudioImportPreviewRequest {
        mode: bridge_types::StudioImportMode::Regex,
        manifest_path: None,
        discovery_root: Some(root.to_string_lossy().into_owned()),
        file_pattern: Some(r"sub-(?P<subject>\d+)(?:_odd)?_stat\.nii(\.gz)?$".into()),
        table_source_label: None,
        table_headers: None,
        table_rows: None,
        table_file_path_column: None,
        table_subject_id_column: None,
        table_excluded_columns: None,
        discovery_max_depth: Some(2),
        discovery_max_files: Some(20),
        discovery_include_patterns: None,
        discovery_exclude_patterns: None,
        discovery_required_roles: None,
        discovery_role_patterns: None,
        discovery_dry_run: Some(true),
        discovery_sample_headers: Some(true),
    }
}

/// Set studio's header audit of a remote image set, end to end over SFTP:
/// every member's header is read from the start of its file, nothing is
/// downloaded, and the set is comparable exactly when all grids agree.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn remote_discovery_audits_every_header_without_downloading() {
    use bridge_types::{StudioAlignmentClass, StudioImportReadiness};
    let server = spawn_sftp_server(
        PrivateKey::random(&mut rand::rng(), russh::keys::Algorithm::Ed25519).unwrap(),
        Arc::new(AtomicUsize::new(0)),
        Arc::new(AtomicUsize::new(0)),
    )
    .await;
    let port = server.addr.port();
    let config = ConnectConfig::new(server.addr.ip().to_string(), "fixture")
        .port(port)
        .auth(AuthMethod::Password("ephemeral-test-only".into()))
        .connect_timeout(Duration::from_secs(5))
        .operation_timeout(Duration::from_secs(5))
        .retry_count(0)
        .skip_host_key_verification();
    let client = Arc::new(RemoteClient::connect(config).await.unwrap());
    let root = std::env::temp_dir().join(format!("brainflow-audit-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    let cleanup = super::Staging(root.clone());
    let mount = crate::RemoteMountEntry {
        mount_id: "audit".into(),
        local_root: root.clone(),
        remote_root: "/".into(),
        display_name: "fixture".into(),
        origin_label: "fixture@127.0.0.1:/".into(),
        host: "127.0.0.1".into(),
        connect_host: "127.0.0.1".into(),
        port,
        user: "fixture".into(),
        client: client.clone(),
        op_semaphore: Arc::new(tokio::sync::Semaphore::new(2)),
        transfers: Arc::new(super::Control::default()),
        progress: Arc::new(|_| {}),
    };
    let state = crate::BridgeState::default().unwrap();
    state
        .remote_mounts
        .lock()
        .await
        .insert("audit".into(), mount.clone());
    let preview = |scenario: &'static str| {
        let request = audit_request(&root.join("audit").join(scenario));
        let state = &state;
        async move {
            crate::preview_set_studio_imports_for_testing(request, Some(state))
                .await
                .unwrap()
                .remove(0)
        }
    };
    let note = |candidate: &bridge_types::StudioImportCandidate, needle: &str| {
        candidate
            .set
            .ingest_audit
            .notes
            .iter()
            .any(|note| note.contains(needle))
    };

    // Three members on one grid: comparable, from a few kilobytes each.
    let same = preview("same").await;
    assert_eq!(same.set.member_count, 3);
    assert_eq!(same.set.alignment_class, StudioAlignmentClass::SameGrid);
    assert_eq!(
        same.set.support_label,
        "8×8×4 voxels · 2.00×2.00×2.00 mm (sampled)"
    );
    assert!(same.set.ingest_audit.support.ready_for_compare);
    assert_eq!(same.contract.readiness, StudioImportReadiness::CompareReady);
    assert!(note(
        &same,
        "Read 3 image header(s) over the remote mount and 0 from the local cache"
    ));
    assert!(!note(&same, "could not be read"));
    let served = AUDIT_BYTES_SERVED.load(Ordering::SeqCst);
    assert!(AUDIT_IMAGE.len() > 1 << 20);
    assert!(
        served > 0 && served <= 3 * 32 * 1024,
        "{served} bytes served for three headers"
    );
    assert_eq!(
        std::fs::read_dir(&root).unwrap().count(),
        0,
        "the audit stages nothing in the cache"
    );
    assert_eq!(mount.op_semaphore.available_permits(), 2);

    // One member on another grid: named, and not comparable.
    let mixed = preview("mixed").await;
    assert_eq!(mixed.set.alignment_class, StudioAlignmentClass::Mixed);
    assert!(!mixed.set.ingest_audit.support.ready_for_compare);
    assert_ne!(
        mixed.contract.readiness,
        StudioImportReadiness::CompareReady
    );
    let mismatch = mixed
        .set
        .ingest_audit
        .join
        .issue_details
        .iter()
        .find(|issue| issue.message.contains("different grid"))
        .expect("grid mismatch issue");
    assert_eq!(mismatch.member_ids, ["02"]);

    // One member whose bytes are not NIfTI: named, and not comparable.
    let broken = preview("broken").await;
    assert!(!broken.set.ingest_audit.support.ready_for_compare);
    let unreadable = broken
        .set
        .ingest_audit
        .join
        .issue_details
        .iter()
        .find(|issue| issue.message.contains("could not be read"))
        .expect("unreadable header issue");
    assert_eq!(unreadable.member_ids, ["02"]);
    assert!(unreadable.message.contains("sub-02_stat.nii"));
    // The file is named as its member row names it, not by its cache path.
    assert!(
        unreadable
            .message
            .contains("first error: sub-02_stat.nii: "),
        "{}",
        unreadable.message
    );
    assert!(
        !unreadable.message.contains(&*root.to_string_lossy()),
        "{}",
        unreadable.message
    );
    // The note counts headers that were read, and says how many were not.
    assert!(note(
        &broken,
        "Read 2 image header(s) over the remote mount and 0 from the local cache; no image was downloaded. 1 image header(s) could not be read."
    ));

    // A member already in the cache, with a sidecar matching the listing, is
    // read from disk; a stale sidecar sends the read back to the server.
    let cached = root.join("audit/same/sub-02_stat.nii.gz");
    std::fs::create_dir_all(cached.parent().unwrap()).unwrap();
    std::fs::write(&cached, &**AUDIT_IMAGE).unwrap();
    let sidecar = crate::remote_cache_metadata_path(&mount, &cached).unwrap();
    let sidecar_root =
        crate::remote_cache_metadata_root()
            .unwrap()
            .join(crate::remote_cache::identity(
                "127.0.0.1",
                port,
                "fixture",
                "/",
            ));
    let _sidecar_cleanup = super::Staging(sidecar_root);
    let mut metadata = crate::RemoteFileCacheMetadata {
        version: 2,
        mount_id: "audit".into(),
        host: "127.0.0.1".into(),
        port,
        user: "fixture".into(),
        remote_path: "/audit/same/sub-02_stat.nii.gz".into(),
        remote_size: AUDIT_IMAGE.len() as u64,
        remote_modified_unix_secs: Some(AUDIT_MODIFIED as u64),
    };
    crate::save_remote_file_cache_metadata(&sidecar, &metadata)
        .await
        .unwrap();
    let before = AUDIT_BYTES_SERVED.load(Ordering::SeqCst);
    let hit = preview("same").await;
    assert!(hit.set.ingest_audit.support.ready_for_compare);
    assert!(note(
        &hit,
        "Read 2 image header(s) over the remote mount and 1 from the local cache"
    ));
    assert!(AUDIT_BYTES_SERVED.load(Ordering::SeqCst) - before <= 2 * 32 * 1024);
    metadata.remote_modified_unix_secs = Some(AUDIT_MODIFIED as u64 - 60);
    crate::save_remote_file_cache_metadata(&sidecar, &metadata)
        .await
        .unwrap();
    let stale = preview("same").await;
    assert!(stale.set.ingest_audit.support.ready_for_compare);
    assert!(note(
        &stale,
        "Read 3 image header(s) over the remote mount and 0 from the local cache"
    ));

    // The mount is replaced while its headers are in hand (same folder, new
    // session): the audit is void, whatever the headers said.
    let listing = crate::list_remote_discovery_inventory_files(
        &mount,
        &root.join("audit/same"),
        "/audit/same",
        Some(2),
        200,
    )
    .await
    .unwrap();
    let files: Vec<String> = listing
        .files
        .iter()
        .map(|file| file.source_path.clone())
        .collect();
    assert_eq!(files.len(), 3);
    let listed = listing.listed;
    let audit = crate::audit_remote_discovery_headers(&state, &mount, &root, &files, &listed).await;
    assert!(audit.failure.is_none());
    assert!(audit.headers.values().all(Result::is_ok));
    let mut replacement = mount.clone();
    replacement.mount_id = "audit-reconnected".into();
    {
        let mut mounts = state.remote_mounts.lock().await;
        mounts.remove("audit");
        mounts.insert("audit-reconnected".into(), replacement);
    }
    let audit = crate::audit_remote_discovery_headers(&state, &mount, &root, &files, &listed).await;
    assert!(audit
        .failure
        .as_ref()
        .unwrap()
        .contains("unmounted or replaced"));

    // Unmounted mid-flight: every read refuses, and the audit says why.
    state.remote_mounts.lock().await.clear();
    mount.transfers.stop();
    let audit =
        crate::audit_remote_discovery_headers(&state, &mount, &root, &files[..2], &listed).await;
    assert!(audit.failure.is_some());
    assert!(audit.headers[&files[0]]
        .as_ref()
        .unwrap_err()
        .contains("unmounted"));
    assert_eq!(
        audit.notes,
        ["Read 0 image header(s) over the remote mount and 0 from the local cache; no image was downloaded. 2 image header(s) could not be read."]
    );
    assert_eq!(mount.op_semaphore.available_permits(), 2);
    assert!(
        !root.join("audit/same/sub-01_stat.nii.gz").exists(),
        "no partial cache state"
    );

    client.close().await.unwrap();
    server.shutdown.shutdown("done".into());
    let _ = server.join.await;
    drop(cleanup);
}

/// An audit dropped part-way (the preview's ticket expired, or it was
/// cancelled) keeps the headers it had read: the next audit of the same files
/// reads only the rest. A file whose listing changed is read again, and an
/// audit that finished leaves nothing behind.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn remote_header_audit_continues_after_one_that_was_dropped() {
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
    let root = std::env::temp_dir().join(format!("brainflow-resume-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    let cleanup = super::Staging(root.clone());
    let mount = crate::RemoteMountEntry {
        mount_id: "resume".into(),
        local_root: root.clone(),
        remote_root: "/".into(),
        display_name: "fixture".into(),
        origin_label: "fixture@127.0.0.1:/".into(),
        host: "127.0.0.1".into(),
        connect_host: "127.0.0.1".into(),
        port: server.addr.port(),
        user: "fixture".into(),
        client: client.clone(),
        op_semaphore: Arc::new(tokio::sync::Semaphore::new(2)),
        transfers: Arc::new(super::Control::default()),
        progress: Arc::new(|_| {}),
    };
    let state = crate::BridgeState::default().unwrap();
    state
        .remote_mounts
        .lock()
        .await
        .insert("resume".into(), mount.clone());

    // Three files that answer at once, then sixty that take 30 ms each: two at
    // a time, the whole audit needs most of a second.
    let names: Vec<String> = (0..3)
        .map(|i| format!("fast-{i}.nii.gz"))
        .chain((0..60).map(|i| format!("slow-{i:02}.nii.gz")))
        .collect();
    let total = names.len();
    let files: Vec<String> = names
        .iter()
        .map(|name| {
            root.join("resume")
                .join(name)
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    let listing = |modified: u64| -> std::collections::HashMap<String, crate::RemoteListedFile> {
        names
            .iter()
            .zip(&files)
            .map(|(name, source_path)| {
                (
                    source_path.clone(),
                    crate::RemoteListedFile {
                        remote_path: format!("/resume/{name}"),
                        metadata: remotely::fs::Metadata {
                            file_type: remotely::fs::FileType::File,
                            size: AUDIT_IMAGE.len() as u64,
                            permissions: 0o100_644,
                            uid: None,
                            gid: None,
                            accessed: None,
                            modified: Some(std::time::UNIX_EPOCH + Duration::from_secs(modified)),
                        },
                    },
                )
            })
            .collect()
    };
    let listed = listing(AUDIT_MODIFIED as u64);
    let reads = || RESUME_HEADER_READS.load(Ordering::SeqCst) as usize;
    let settled = || async {
        for _ in 0..100 {
            if mount.op_semaphore.available_permits() == 2 {
                return;
            }
            sleep(Duration::from_millis(20)).await;
        }
        panic!("the dropped audit did not return its permits");
    };

    // The first audit is dropped after 300 ms, as an expired ticket drops it.
    let first = crate::audit_remote_discovery_headers(&state, &mount, &root, &files, &listed);
    assert!(tokio::time::timeout(Duration::from_millis(300), first)
        .await
        .is_err());
    settled().await;
    let after_first = reads();
    assert!(after_first >= 1, "the dropped audit read some headers");
    assert!(after_first < total, "the dropped audit did not finish");

    // The second reads only what the first had not: together they read each
    // header once (plus at most the two reads in flight at the drop).
    let second =
        crate::audit_remote_discovery_headers(&state, &mount, &root, &files, &listed).await;
    let second_reads = reads() - after_first;
    assert!(second.failure.is_none());
    assert_eq!(second.headers.len(), total);
    assert!(second.headers.values().all(Result::is_ok));
    assert!(second_reads < total, "headers already read were read again");
    let kept = total - second_reads;
    assert!(kept >= 1);
    assert!(after_first >= kept && after_first <= kept + 2);
    assert_eq!(
        second.notes,
        [format!(
            "Read {second_reads} image header(s) over the remote mount and 0 from the local cache; no image was downloaded. {kept} image header(s) were kept from a check that was stopped."
        )]
    );
    for header in second.headers.values() {
        assert_eq!(header.as_ref().unwrap().dim, [8, 8, 4]);
    }

    // An audit that finished leaves nothing to continue from.
    let before = reads();
    let third = crate::audit_remote_discovery_headers(&state, &mount, &root, &files, &listed).await;
    assert_eq!(reads() - before, total);
    assert_eq!(
        third.notes,
        [format!(
            "Read {total} image header(s) over the remote mount and 0 from the local cache; no image was downloaded."
        )]
    );

    // A file that changed on the server (another modification time) is not
    // continued from what was read of the old one.
    let dropped = crate::audit_remote_discovery_headers(&state, &mount, &root, &files, &listed);
    assert!(tokio::time::timeout(Duration::from_millis(300), dropped)
        .await
        .is_err());
    settled().await;
    let before = reads();
    let changed = listing(AUDIT_MODIFIED as u64 + 60);
    let fourth =
        crate::audit_remote_discovery_headers(&state, &mount, &root, &files, &changed).await;
    assert_eq!(reads() - before, total);
    assert!(fourth.headers.values().all(Result::is_ok));

    client.close().await.unwrap();
    server.shutdown.shutdown("done".into());
    let _ = server.join.await;
    drop(cleanup);
}

/// Dropping the audit (the preview command's cancellation) stops the worker:
/// the permits come back and later operations on the mount proceed.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn dropping_a_remote_header_read_releases_the_mount() {
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
    let mount = crate::RemoteMountEntry {
        mount_id: "fixture".into(),
        local_root: std::env::temp_dir(),
        remote_root: "/".into(),
        display_name: "fixture".into(),
        origin_label: "fixture".into(),
        host: "127.0.0.1".into(),
        connect_host: "127.0.0.1".into(),
        port: server.addr.port(),
        user: "fixture".into(),
        client: client.clone(),
        op_semaphore: Arc::new(tokio::sync::Semaphore::new(2)),
        transfers: Arc::new(super::Control::default()),
        progress: Arc::new(|_| {}),
    };
    // `.nii` reads take 30 ms each on this server, so 400 of them cannot
    // finish inside the 50 ms the caller waits.
    let paths: Vec<String> = (0..400).map(|i| format!("/slow-{i}.nii")).collect();
    let read = super::read_headers_owned(mount.clone(), paths);
    assert!(tokio::time::timeout(Duration::from_millis(50), read)
        .await
        .is_err());
    let mut released = false;
    for _ in 0..100 {
        if mount.op_semaphore.available_permits() == 2 {
            released = true;
            break;
        }
        sleep(Duration::from_millis(20)).await;
    }
    assert!(released, "the cancelled worker returned its permits");
    let after = super::read_headers_owned(mount.clone(), vec!["/sub-01_bold.nii.gz".into()]).await;
    assert_eq!(after[0].as_ref().unwrap().dim, [8, 8, 4, 12]);
    client.close().await.unwrap();
    server.shutdown.shutdown("done".into());
    let _ = server.join.await;
}

/// The dataset-card probes over a mount: they list and read small text files
/// under the mount's permits, read image headers from a prefix, download
/// nothing, leave nothing in the local mirror, and are void if the mount is
/// replaced while they run.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn remote_dataset_cards_read_small_files_and_no_image_payload() {
    use crate::dataset_card::{card_impl, markers_impl, sidecar_impl};
    use bridge_types::{BridgeError, SidecarLevel};
    let server = spawn_sftp_server(
        PrivateKey::random(&mut rand::rng(), russh::keys::Algorithm::Ed25519).unwrap(),
        Arc::new(AtomicUsize::new(0)),
        Arc::new(AtomicUsize::new(0)),
    )
    .await;
    let port = server.addr.port();
    let config = ConnectConfig::new(server.addr.ip().to_string(), "fixture")
        .port(port)
        .auth(AuthMethod::Password("ephemeral-test-only".into()))
        .connect_timeout(Duration::from_secs(5))
        .operation_timeout(Duration::from_secs(5))
        .retry_count(0)
        .skip_host_key_verification();
    let client = Arc::new(RemoteClient::connect(config).await.unwrap());
    let root = std::env::temp_dir().join(format!("brainflow-cards-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    let cleanup = super::Staging(root.clone());
    let mount = crate::RemoteMountEntry {
        mount_id: "cards".into(),
        local_root: root.clone(),
        remote_root: "/".into(),
        display_name: "fixture".into(),
        origin_label: "fixture@127.0.0.1:/".into(),
        host: "127.0.0.1".into(),
        connect_host: "127.0.0.1".into(),
        port,
        user: "fixture".into(),
        client: client.clone(),
        op_semaphore: Arc::new(tokio::sync::Semaphore::new(2)),
        transfers: Arc::new(super::Control::default()),
        progress: Arc::new(|_| {}),
    };
    let state = crate::BridgeState::default().unwrap();
    state
        .remote_mounts
        .lock()
        .await
        .insert("cards".into(), mount.clone());
    let local = |rel: &str| root.join(rel).to_string_lossy().into_owned();
    let untouched = || {
        assert_eq!(mount.op_semaphore.available_permits(), 2);
        assert_eq!(
            std::fs::read_dir(&root).unwrap().count(),
            0,
            "nothing is staged or mirrored locally"
        );
    };

    // Markers: the dataset, its derivatives folder, an analysis, a subject.
    let asked = vec![
        local("cards/study"),
        local("cards/study/derivatives"),
        local("cards/study/derivatives/glm"),
        local("cards/study/sub-01"),
        local("cards/nowhere"),
    ];
    let markers = markers_impl(&state, asked.clone(), None).await.unwrap();
    assert_eq!(markers.len(), 5);
    assert_eq!(markers[0].path, asked[0]);
    assert!(markers[0].has_description);
    assert_eq!(markers[0].analysis_count, Some(2));
    let summary = markers[0].summary.as_ref().unwrap();
    assert_eq!(summary.name.as_deref(), Some("Study"));
    assert_eq!(summary.dataset_type.as_deref(), Some("raw"));
    assert!(!markers[1].has_description);
    assert_eq!(markers[1].analysis_count, Some(2));
    assert!(markers[2].has_description);
    assert_eq!(markers[2].analysis_count, None);
    let pipeline = markers[2].summary.as_ref().unwrap().generated_by.as_ref();
    assert_eq!(pipeline.unwrap().name, "fitlins");
    assert_eq!(pipeline.unwrap().version.as_deref(), Some("0.11"));
    assert!(!markers[3].has_description && markers[3].analysis_count.is_none());
    assert!(markers[4]
        .issue
        .as_deref()
        .unwrap()
        .contains("could not be read"));
    untouched();
    // Asked again while fresh, the server is not read at all.
    let reads = CARDS_READS.load(Ordering::SeqCst);
    let again = markers_impl(&state, asked[..4].to_vec(), None)
        .await
        .unwrap();
    assert_eq!(again, markers[..4]);
    assert_eq!(CARDS_READS.load(Ordering::SeqCst), reads);

    // A plain remote folder of analyses: its marker does not list the
    // children (each a round trip under the mount's permits); its card does.
    let pile = markers_impl(&state, vec![local("cards/pile")], None)
        .await
        .unwrap();
    assert_eq!(pile[0].analysis_count, None);
    assert_eq!(pile[0].issue, None);
    let pile = card_impl(&state, local("cards/pile"), None, false)
        .await
        .unwrap();
    assert_eq!(pile.analyses.len(), 2);
    untouched();

    // The card of the raw dataset.
    let card = card_impl(&state, local("cards/study"), None, false)
        .await
        .unwrap();
    assert_eq!(card.path, local("cards/study"));
    let description = card.description.as_ref().unwrap();
    assert_eq!(description.name.as_deref(), Some("Study"));
    assert_eq!(description.bids_version.as_deref(), Some("1.9.0"));
    assert_eq!(description.other_fields[0].key, "Lab");
    assert_eq!(description.other_fields[0].value, r#"{"room":4}"#);
    assert_eq!(card.description_issue, None);
    assert!(card
        .description_raw
        .as_deref()
        .unwrap()
        .starts_with(r#"{"Name": "Study""#));
    let readme = card.readme.as_ref().unwrap();
    assert_eq!(
        (readme.file_name.as_str(), readme.text.as_str()),
        ("README", "Remote readme")
    );
    assert_eq!(card.contents.subject_count, 1);
    assert_eq!(card.contents.tasks, ["rest"]);
    assert_eq!(card.contents.image_count, 1);
    assert!(!card.contents.truncated);
    assert_eq!(
        card.contents.image_kinds[0].path,
        "func/sub-*_task-rest_bold.nii.gz"
    );
    assert_eq!(
        card.analyses_path.as_deref(),
        Some(local("cards/study/derivatives").as_str())
    );
    let names: Vec<&str> = card
        .analyses
        .iter()
        .map(|a| a.folder_name.as_str())
        .collect();
    assert_eq!(names, ["bare", "glm"]);
    let bare = &card.analyses[0];
    assert!(!bare.has_description && bare.title.is_none() && !bare.has_group_level);
    assert_eq!(bare.subject_count, 1);
    let glm = &card.analyses[1];
    assert_eq!(glm.path, local("cards/study/derivatives/glm"));
    assert_eq!(glm.title.as_deref(), Some("GLM"));
    assert_eq!(glm.generated_by.as_ref().unwrap().name, "fitlins");
    assert_eq!(glm.subject_count, 1);
    assert!(glm.has_group_level && glm.has_description);
    assert_eq!(
        card.source_paths,
        [
            local("cards/study/dataset_description.json"),
            local("cards/study/README"),
            local("cards/study/derivatives/glm/dataset_description.json"),
        ]
    );
    untouched();

    // An analysis that is not entity-named: its kinds say what it holds.
    let glm_card = card_impl(&state, local("cards/study/derivatives/glm"), None, false)
        .await
        .unwrap();
    assert_eq!(
        glm_card.contents.image_kinds[0].path,
        "maps/same_item.nii.gz"
    );
    assert!(glm_card.contents.has_group_level);
    assert_eq!(glm_card.contents.group_image_count, 1);
    assert!(glm_card.analyses.is_empty());

    // The sidecar card: header from a prefix, metadata merged by level.
    let image = "cards/study/sub-01/func/sub-01_task-rest_bold.nii.gz";
    let sidecar = sidecar_impl(&state, local(image), None).await.unwrap();
    let header = sidecar.header.as_ref().unwrap();
    assert_eq!(header.dim, [8, 8, 4]);
    assert_eq!(header.voxel_sizes, [2.0, 2.0, 2.0]);
    assert_eq!(header.datatype.as_deref(), Some("float32"));
    assert_eq!(sidecar.dataset_root, Some(local("cards/study")));
    assert!(sidecar.issues.is_empty(), "{:?}", sidecar.issues);
    let entries: Vec<(&str, &str, SidecarLevel)> = sidecar
        .entries
        .iter()
        .map(|e| (e.key.as_str(), e.value.as_str(), e.source_level))
        .collect();
    assert_eq!(
        entries,
        [
            ("EchoTime", "0.03", SidecarLevel::File),
            ("RepetitionTime", "2.0", SidecarLevel::Dataset),
        ]
    );
    assert_eq!(
        sidecar.entries[0].overridden_paths,
        [local("cards/study/task-rest_bold.json")]
    );
    untouched();

    // Four images were counted and one header read: a megabyte each on the
    // server, and only the start of one crossed the wire.
    assert!(AUDIT_IMAGE.len() > 1 << 20);
    let served = CARDS_IMAGE_BYTES_SERVED.load(Ordering::SeqCst);
    assert!(served <= 64 * 1024, "{served} image bytes served");

    // The two phases on a mount. The descriptions phase reads the folder's
    // own files and each child's description by name: no child is listed
    // and nothing is walked.
    {
        use crate::dataset_card::card_phase_impl;
        use bridge_types::DatasetCardPhase::{Descriptions, Full};
        let study = || local("cards/study");
        let reads = CARDS_READS.load(Ordering::SeqCst);
        let outline = card_phase_impl(&state, study(), None, true, Descriptions)
            .await
            .unwrap();
        assert_eq!(outline.phase, Descriptions);
        // The description, the README and the one child description.
        assert_eq!(CARDS_READS.load(Ordering::SeqCst), reads + 3);
        assert_eq!(outline.description, card.description);
        assert_eq!(outline.readme, card.readme);
        assert_eq!(outline.source_paths, card.source_paths);
        assert_eq!(outline.contents, bridge_types::DatasetContents::default());
        assert_eq!(outline.analyses.len(), 1);
        assert_eq!(outline.analyses[0].title.as_deref(), Some("GLM"));
        assert_eq!(outline.analyses[0].subject_count, 0);
        // The full phase reads no file again, and is the card built in one go.
        let whole = card_phase_impl(&state, study(), None, false, Full)
            .await
            .unwrap();
        assert_eq!(CARDS_READS.load(Ordering::SeqCst), reads + 3);
        assert_eq!(whole, card);
        // Reopened within the session: either phase is the whole card.
        let reopened = card_phase_impl(&state, study(), None, false, Descriptions)
            .await
            .unwrap();
        assert_eq!(reopened, card);
        assert_eq!(CARDS_READS.load(Ordering::SeqCst), reads + 3);
        untouched();
    }

    // A path that leaves the mount, or the browse root inside it, is refused.
    let outside = format!("{}/../elsewhere", local("cards/study"));
    let error = card_impl(&state, outside, None, false).await.unwrap_err();
    assert!(matches!(error, BridgeError::Input { code: 8260, .. }));
    let error = sidecar_impl(&state, local(image), Some(local("cards/study/derivatives")))
        .await
        .unwrap_err();
    assert!(matches!(error, BridgeError::Input { code: 8261, .. }));

    // Dropping a card (the UI moved on) stops its worker: the permits return.
    let abandoned = card_impl(&state, local("cards/study"), None, true);
    assert!(tokio::time::timeout(Duration::from_millis(20), abandoned)
        .await
        .is_err());
    let mut released = false;
    for _ in 0..100 {
        if mount.op_semaphore.available_permits() == 2 {
            released = true;
            break;
        }
        sleep(Duration::from_millis(20)).await;
    }
    assert!(released, "the abandoned card returned its permits");

    // The mount is replaced while a card is being read (same folder, new
    // session): what was read describes a mount the user no longer has.
    let reads = CARDS_READS.load(Ordering::SeqCst);
    let replace = async {
        while CARDS_READS.load(Ordering::SeqCst) == reads {
            sleep(Duration::from_millis(2)).await;
        }
        let mut replacement = mount.clone();
        replacement.mount_id = "cards-reconnected".into();
        let mut mounts = state.remote_mounts.lock().await;
        mounts.remove("cards");
        mounts.insert("cards-reconnected".into(), replacement);
    };
    let (voided, ()) = tokio::join!(
        card_impl(&state, local("cards/study/derivatives/glm"), None, true),
        replace
    );
    let error = voided.unwrap_err();
    assert!(matches!(error, BridgeError::Io { code: 8262, .. }));
    assert!(error.to_string().contains("unmounted or replaced"));
    let reads = CARDS_READS.load(Ordering::SeqCst);
    let (voided, ()) = tokio::join!(sidecar_impl(&state, local(image), None), async {
        while CARDS_READS.load(Ordering::SeqCst) == reads {
            sleep(Duration::from_millis(2)).await;
        }
        let mut mounts = state.remote_mounts.lock().await;
        let mut original = mounts.remove("cards-reconnected").unwrap();
        original.mount_id = "cards".into();
        mounts.insert("cards".into(), original);
    });
    assert!(voided
        .unwrap_err()
        .to_string()
        .contains("unmounted or replaced"));
    untouched();
    // The mount that is there now answers again.
    assert!(sidecar_impl(&state, local(image), None).await.is_ok());

    // The session is stopped (an unmount in progress): every probe refuses
    // with a typed error that says what to do, before any I/O.
    mount.transfers.stop();
    let inactive = |error: BridgeError| {
        assert!(
            matches!(error, BridgeError::Input { code: 8232, .. }),
            "{error:?}"
        );
        assert!(error.to_string().contains("Reconnect the remote folder"));
    };
    inactive(
        card_impl(&state, local("cards/study"), None, true)
            .await
            .unwrap_err(),
    );
    inactive(
        markers_impl(&state, vec![local("cards/study/sub-01/func")], None)
            .await
            .unwrap_err(),
    );
    inactive(sidecar_impl(&state, local(image), None).await.unwrap_err());
    untouched();

    client.close().await.unwrap();
    server.shutdown.shutdown("done".into());
    let _ = server.join.await;
    drop(cleanup);
}

#[path = "studio_source_fetch_tests.rs"]
mod studio_source_fetch_tests;
