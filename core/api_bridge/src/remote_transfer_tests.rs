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

use rand_core::OsRng;
use russh::keys::PrivateKey;
use russh::server::{self, Auth, Config, Msg, RunningServerHandle, Server as _, Session};
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
        _session: &mut Session,
    ) -> Result<bool, Self::Error> {
        self.channel_opens.fetch_add(1, Ordering::SeqCst);
        self.channels.lock().await.insert(channel.id(), channel);
        Ok(true)
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
        let handle = if path.ends_with(".nii.gz") {
            "gz"
        } else {
            "file"
        };
        Ok(Handle {
            id,
            handle: handle.into(),
        })
    }
    async fn read(
        &mut self,
        id: u32,
        handle: String,
        offset: u64,
        len: u32,
    ) -> Result<Data, Self::Error> {
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

    async fn opendir(&mut self, id: u32, _path: String) -> Result<Handle, Self::Error> {
        // Hand out a unique handle per open so concurrent listings of the same
        // directory don't share read-EOF state.
        let n = self.next_handle.fetch_add(1, Ordering::SeqCst);
        Ok(Handle {
            id,
            handle: format!("dir-{n}"),
        })
    }

    async fn readdir(&mut self, id: u32, handle: String) -> Result<Name, Self::Error> {
        if self.dir_read_done.contains(&handle) {
            return Err(StatusCode::Eof);
        }
        self.dir_read_done.insert(handle);
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

    async fn stat(&mut self, id: u32, _path: String) -> Result<Attrs, Self::Error> {
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
        PrivateKey::random(&mut OsRng, russh::keys::Algorithm::Ed25519).unwrap(),
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
        PrivateKey::random(&mut OsRng, russh::keys::Algorithm::Ed25519).unwrap(),
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
