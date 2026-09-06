//! Content-addressed source copies. Copy and hash the same bytes under export ownership.
use super::*;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};
const PREFIX: &str = "bundle:sha256:";
const MAX_SOURCE: u64 = 2 * 1024 * 1024 * 1024;
const MAX_BUNDLE: u64 = 4 * 1024 * 1024 * 1024;
pub(super) fn retain(
    calculation: &mut PopulationSliceRequest,
    paths: &[PathBuf],
    mask_path: Option<&Path>,
    destination: &Path,
    token: &SampleCancellation,
) -> BridgeResult<()> {
    let dir = destination.join("inputs");
    fs::create_dir(&dir)?;
    let mut copied = HashMap::<String, String>::new();
    let mut total = 0u64;
    let mut copy = |path: &Path, digest: &str| -> BridgeResult<String> {
        if let Some(uri) = copied.get(digest) {
            return Ok(uri.clone());
        }
        token.check()?;
        let mut source = fs::File::open(path)?;
        let size = source.metadata()?.len();
        if !source.metadata()?.is_file() || size > MAX_SOURCE || size > MAX_BUNDLE - total {
            return Err(input(
                "Included inputs exceed the 2 GiB per-source / 4 GiB bundle limit.",
            ));
        }
        let mut head = [0u8; 2];
        source.read_exact(&mut head)?;
        let suffix = if head == [0x1f, 0x8b] {
            ".nii.gz"
        } else {
            ".nii"
        };
        let name = format!("{digest}{suffix}");
        let mut out = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(dir.join(&name))?;
        let mut hash = Sha256::new();
        hash.update(head);
        out.write_all(&head)?;
        let mut count = 2u64;
        let mut buffer = [0u8; 65536];
        loop {
            token.check()?;
            let n = source.read(&mut buffer)?;
            if n == 0 {
                break;
            }
            count += n as u64;
            if count > MAX_SOURCE || count > MAX_BUNDLE - total {
                return Err(input("Included source grew beyond the copy budget."));
            }
            hash.update(&buffer[..n]);
            out.write_all(&buffer[..n])?;
        }
        if count != size || format!("{:x}", hash.finalize()) != digest {
            return Err(input(
                "Source changed while retaining inputs; no bundle was published.",
            ));
        }
        out.sync_all()?;
        total += count;
        let uri = format!("{PREFIX}{name}");
        copied.insert(digest.to_owned(), uri.clone());
        Ok(uri)
    };
    for (member, path) in calculation.members.iter_mut().zip(paths) {
        member.source_path = copy(
            path,
            member
                .expected_sha256
                .as_deref()
                .ok_or_else(|| input("Input digest missing."))?,
        )?;
    }
    if let Some(mask) = &mut calculation.mask {
        mask.source_path = copy(
            mask_path.ok_or_else(|| input("Mask input missing."))?,
            mask.expected_sha256
                .as_deref()
                .ok_or_else(|| input("Mask digest missing."))?,
        )?;
    }
    Ok(())
}
pub(super) fn resolve(
    calculation: &mut PopulationSliceRequest,
    parent: &Path,
) -> BridgeResult<Vec<PathBuf>> {
    let parent = fs::canonicalize(parent)?;
    let mut paths = Vec::new();
    let mut resolve = |source: &mut String, digest: Option<&str>| -> BridgeResult<()> {
        if let Some(name) = source.strip_prefix(PREFIX) {
            let hash = digest.ok_or_else(|| input("Retained input digest missing."))?;
            if hash.len() != 64
                || !hash.bytes().all(|c| c.is_ascii_hexdigit())
                || (name != format!("{hash}.nii") && name != format!("{hash}.nii.gz"))
            {
                return Err(input("Invalid content-addressed input name."));
            }
            let path = fs::canonicalize(parent.join("inputs").join(name))?;
            if !path.starts_with(parent.join("inputs")) {
                return Err(input("Retained input escapes its bundle."));
            }
            *source = path.to_string_lossy().into_owned();
            paths.push(path);
        }
        Ok(())
    };
    for m in &mut calculation.members {
        resolve(&mut m.source_path, m.expected_sha256.as_deref())?;
    }
    if let Some(m) = &mut calculation.mask {
        resolve(&mut m.source_path, m.expected_sha256.as_deref())?;
    }
    Ok(paths)
}
