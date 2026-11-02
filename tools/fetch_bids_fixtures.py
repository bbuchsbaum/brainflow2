#!/usr/bin/env python3
"""Fetch the public BIDS datasets used to validate the BIDS browser.

Data never goes on the system disk. Everything lands under one root on the WD
Passport, and re-running the script reproduces it: `aws s3 sync` skips files
that already match. Datasets are public OpenNeuro snapshots, read anonymously.

    python3 -I tools/fetch_bids_fixtures.py --list
    python3 -I tools/fetch_bids_fixtures.py --dry-run
    python3 -I tools/fetch_bids_fixtures.py [ds000114 ds001734]
    python3 -I tools/fetch_bids_fixtures.py --verify

Layout (see DATA_ROOT/README.md, written by this script):

    <root>/<dataset>/                 BIDS root; open this in Brainflow
    <root>/<dataset>/derivatives/     fmriprep (metadata only), mriqc (group TSVs)
    <root>/<dataset>/MANIFEST.json    what was fetched, from where and when

Set BRAINFLOW_BIDS_DATA to use another root. Requires the AWS CLI; no account.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

PASSPORT = Path("/Volumes/My Passport for Mac")
DEFAULT_ROOT = PASSPORT / "data" / "brainflow-bids"
RAW_BUCKET = "s3://openneuro.org"
DERIV_BUCKET = "s3://openneuro-derivatives"

# Metadata and confounds only: the preprocessed images alone are tens of GB and
# the browser reads none of them.
FMRIPREP_PATTERNS = (
    "dataset_description.json",
    "sub-*desc-confounds_timeseries.tsv",
    "sub-*desc-confounds_timeseries.json",
    "sub-*desc-preproc_bold.json",
)
MRIQC_PATTERNS = ("dataset_description.json", "group_*.tsv")
SKIPPED_ROOT_FILES = {".gitattributes", ".bidsignore.tmp", "annex-uuid"}


@dataclass(frozen=True)
class Dataset:
    id: str
    why: str
    subjects: tuple[str, ...] = field(default_factory=tuple)  # empty means all

    @property
    def raw(self) -> str:
        return f"{RAW_BUCKET}/{self.id}"


DATASETS = (
    Dataset(
        "ds000114",
        "Test-retest: 2 sessions, 5 tasks, dwi, events, fMRIPrep and MRIQC. All 10 subjects.",
    ),
    Dataset(
        "ds001734",
        "NARPS: run entities, phasediff field maps, sbref, fMRIPrep and MRIQC. The first 7 of 108"
        " subjects, so participants.tsv lists subjects with no local data on purpose.",
        tuple(f"sub-{n:03d}" for n in (1, 2, 3, 4, 5, 6, 8)),
    ),
)


def run(cmd: list[str], *, dry: bool = False, capture: bool = False) -> str:
    print("+ " + " ".join(cmd[:6]) + (" ..." if len(cmd) > 6 else ""), flush=True)
    if dry and not capture:
        return ""
    done = subprocess.run(
        cmd, check=True, text=True, stdout=subprocess.PIPE if capture else None
    )
    return done.stdout or ""


def aws_ls(uri: str, recursive: bool = False) -> list[tuple[int, str]]:
    """Return (size, key) for objects below `uri`, keys relative to it."""
    cmd = ["aws", "s3", "ls", "--no-sign-request", uri.rstrip("/") + "/"]
    if recursive:
        cmd.append("--recursive")
    out = subprocess.run(cmd, check=True, text=True, stdout=subprocess.PIPE).stdout
    prefix = uri.split("/", 3)[3].rstrip("/") + "/"
    rows = []
    for line in out.splitlines():
        parts = line.split(None, 3)
        if len(parts) != 4 or parts[0] == "PRE":
            continue
        key = parts[3][len(prefix) :] if recursive else parts[3]
        rows.append((int(parts[2]), key))
    return rows


def sync(src: str, dest: Path, includes: list[str], dry: bool) -> None:
    dest.mkdir(parents=True, exist_ok=True) if not dry else None
    cmd = ["aws", "s3", "sync", "--no-sign-request", "--no-progress", src, str(dest)]
    cmd += ["--exclude", "*"]
    for pattern in includes:
        cmd += ["--include", pattern]
    if dry:
        cmd.append("--dryrun")
    run(cmd)


def raw_includes(ds: Dataset) -> list[str]:
    roots = [key for _, key in aws_ls(ds.raw) if key not in SKIPPED_ROOT_FILES]
    return roots + ([f"{s}/*" for s in ds.subjects] or ["sub-*"])


def subject_patterns(ds: Dataset, patterns: tuple[str, ...]) -> list[str]:
    """Limit `sub-*` patterns to the dataset's subjects; keep the others as they are."""
    if not ds.subjects:
        return list(patterns)
    out = []
    for pattern in patterns:
        if pattern.startswith("sub-*"):
            out += [f"{s}/*{pattern[len('sub-*'):]}" for s in ds.subjects]
        else:
            out.append(pattern)
    return out


def sources(ds: Dataset, root: Path) -> list[tuple[str, Path, list[str]]]:
    dest = root / ds.id
    return [
        (ds.raw, dest, raw_includes(ds)),
        (
            f"{DERIV_BUCKET}/fmriprep/{ds.id}-fmriprep",
            dest / "derivatives" / "fmriprep",
            subject_patterns(ds, FMRIPREP_PATTERNS),
        ),
        (
            f"{DERIV_BUCKET}/mriqc/{ds.id}-mriqc",
            dest / "derivatives" / "mriqc",
            subject_patterns(ds, MRIQC_PATTERNS),
        ),
    ]


def local_files(path: Path, skip: tuple[str, ...] = ()) -> dict[str, int]:
    files = {}
    for item in path.rglob("*"):
        rel = item.relative_to(path).as_posix()
        if (
            item.is_file()
            and not item.name.startswith("._")
            and not rel.startswith(skip)
        ):
            files[rel] = item.stat().st_size
    return files


def verify(ds: Dataset, root: Path) -> list[str]:
    """Compare every local file with its source object by size."""
    problems: list[str] = []
    for src, dest, _ in sources(ds, root):
        skip = (
            "derivatives/brainflow/",
            "derivatives/fmriprep/",
            "derivatives/mriqc/",
            "MANIFEST.json",
        )
        remote = dict((key, size) for size, key in aws_ls(src, recursive=True))
        have = local_files(dest, skip)
        if not have:
            problems.append(f"{dest}: no files")
        for rel, size in have.items():
            if remote.get(rel) != size:
                problems.append(f"{dest / rel}: local {size}, remote {remote.get(rel)}")
    return problems


def write_manifest(ds: Dataset, root: Path) -> dict:
    dest = root / ds.id
    files = local_files(dest, ("derivatives/brainflow/", "MANIFEST.json"))
    digest = hashlib.sha256(
        "\n".join(f"{k}\t{files[k]}" for k in sorted(files)).encode()
    ).hexdigest()
    manifest = {
        "dataset": ds.id,
        "why": ds.why,
        "subjects": list(ds.subjects) or "all",
        "sources": [src for src, _, _ in sources(ds, root)],
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "file_count": len(files),
        "total_bytes": sum(files.values()),
        "listing_sha256": digest,
    }
    (dest / "MANIFEST.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def write_readme(root: Path) -> None:
    rows = "\n".join(f"- `{d.id}/`: {d.why}" for d in DATASETS)
    (root / "README.md").write_text(
        f"""# Brainflow BIDS validation data

Public OpenNeuro data for testing the BIDS browser on real datasets.
Everything here is regenerable, so it can be deleted at any time:

    python3 -I tools/fetch_bids_fixtures.py

That script, in the brainflow2 repository, is the source of truth for what is
here. Nothing here belongs on the system disk.

{rows}

Each dataset folder is a BIDS root with `derivatives/fmriprep` (confounds and
metadata, no images), `derivatives/mriqc` (group TSVs) and `MANIFEST.json`.
`derivatives/brainflow/`, if present, was written by Brainflow during testing.
"""
    )


def resolve_root() -> Path:
    custom = os.environ.get("BRAINFLOW_BIDS_DATA")
    if custom:
        return Path(custom)
    if not PASSPORT.is_dir():
        sys.exit(
            f"{PASSPORT} is not mounted. Connect the drive or set BRAINFLOW_BIDS_DATA."
        )
    return DEFAULT_ROOT


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("datasets", nargs="*", help="dataset ids (default: all)")
    parser.add_argument(
        "--list", action="store_true", help="show datasets and target root"
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="show what would be copied"
    )
    parser.add_argument(
        "--verify", action="store_true", help="compare local files with S3"
    )
    args = parser.parse_args()

    root = resolve_root()
    known = {d.id: d for d in DATASETS}
    unknown = sorted(set(args.datasets) - set(known))
    if unknown:
        parser.error(f"unknown dataset: {', '.join(unknown)}")
    chosen = [known[i] for i in args.datasets] or list(DATASETS)

    if args.list:
        print(root)
        for ds in chosen:
            print(f"  {ds.id}: {ds.why}")
        return 0

    if args.verify:
        failed = 0
        for ds in chosen:
            problems = verify(ds, root)
            failed += len(problems)
            print(f"{ds.id}: {'ok' if not problems else f'{len(problems)} problems'}")
            for problem in problems[:20]:
                print(f"  {problem}")
        return 1 if failed else 0

    if not args.dry_run:
        root.mkdir(parents=True, exist_ok=True)
        write_readme(root)
    for ds in chosen:
        for src, dest, includes in sources(ds, root):
            sync(src, dest, includes, args.dry_run)
        if not args.dry_run:
            summary = write_manifest(ds, root)
            print(
                f"{ds.id}: {summary['file_count']} files, {summary['total_bytes'] / 1e9:.1f} GB"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
