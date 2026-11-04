#!/usr/bin/env python3
"""Run the fixed persistent R2/R3 qualification campaign.

The runner owns process pairing, schedule persistence, raw protocol receipts,
and cleanup.  Statistical analysis belongs to ``r3_performance_statistics``.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import random
import select
import statistics
import subprocess
import sys
import time
from typing import Any

from r3_performance_statistics import analysis_specification, summarize_campaign


SEED = 20261104
GROUPS = 24
COMPARISONS_PER_GROUP = 5
CONTROL_PER_GROUP = 1
ENDPOINTS = [
    (mode, workload)
    for mode in ("host", "completed")
    for workload in ("steady", "property_patch", "alternating_views")
]
QUARTETS = 4
WARMUP_BATCH_CALLS = 8
TIMED_BATCH_CALLS = 32
ENDPOINT_WARMUP_CALLS = 100
BATCH_TIMEOUT_SECONDS = 120


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def atomic_json(path: Path, value: Any) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    os.replace(temporary, path)


def balanced(rng: random.Random, values: list[Any]) -> list[Any]:
    result = list(values)
    rng.shuffle(result)
    return result


def assignments(rng: random.Random, count: int) -> list[dict[str, str]]:
    assert count % 2 == 0
    physical_a = balanced(rng, ["R2"] * (count // 2) + ["R3"] * (count // 2))
    launch = balanced(rng, ["AB"] * (count // 2) + ["BA"] * (count // 2))
    quartet_start = balanced(rng, ["ABBA"] * (count // 2) + ["BAAB"] * (count // 2))
    return [
        {
            "A": physical_a[index],
            "B": "R3" if physical_a[index] == "R2" else "R2",
            "launch_order": launch[index],
            "quartet_start": quartet_start[index],
        }
        for index in range(count)
    ]


def fixed_schedule(seed: int = SEED) -> list[dict[str, Any]]:
    """Create all 144 sessions before any renderer process starts."""
    rng = random.Random(seed)
    comparison = assignments(rng, GROUPS * COMPARISONS_PER_GROUP)
    control = assignments(rng, GROUPS * CONTROL_PER_GROUP)
    endpoint_offsets = balanced(rng, [index for index in range(len(ENDPOINTS))] * 24)
    schedule: list[dict[str, Any]] = []
    comparison_index = 0
    control_index = 0
    for group in range(GROUPS):
        kinds = ["comparison"] * COMPARISONS_PER_GROUP + ["control"] * CONTROL_PER_GROUP
        rng.shuffle(kinds)
        for ordinal, kind in enumerate(kinds):
            assignment = (
                comparison[comparison_index]
                if kind == "comparison"
                else control[control_index]
            )
            if kind == "comparison":
                comparison_index += 1
            else:
                control_index += 1
            schedule.append(
                {
                    "session": len(schedule),
                    "group": group,
                    "ordinal_in_group": ordinal,
                    "kind": kind,
                    "physical_roles": {"A": assignment["A"], "B": assignment["B"]},
                    "launch_order": assignment["launch_order"],
                    "quartet_start": assignment["quartet_start"],
                    "endpoint_offset": endpoint_offsets[
                        len(schedule) % len(endpoint_offsets)
                    ],
                }
            )
    assert comparison_index == GROUPS * COMPARISONS_PER_GROUP
    assert control_index == GROUPS * CONTROL_PER_GROUP
    assert len(schedule) == 144
    return schedule


def validate_schedule(schedule: list[dict[str, Any]]) -> None:
    assert len(schedule) == 144
    assert sum(item["kind"] == "comparison" for item in schedule) == 120
    assert sum(item["kind"] == "control" for item in schedule) == 24
    for kind, expected in (("comparison", 120), ("control", 24)):
        selected = [item for item in schedule if item["kind"] == kind]
        for field, values in (
            ("A role", [item["physical_roles"]["A"] for item in selected]),
            ("launch", [item["launch_order"] for item in selected]),
            ("quartet", [item["quartet_start"] for item in selected]),
        ):
            assert values.count(values[0]) == expected // 2, (kind, field, values)
    for group in range(GROUPS):
        items = [item for item in schedule if item["group"] == group]
        assert len(items) == 6
        assert sum(item["kind"] == "control" for item in items) == 1


class Renderer:
    def __init__(self, binary: Path, label: str, log: Path):
        self.label = label
        self.log = log.open("w", encoding="utf-8")
        self.process: subprocess.Popen[bytes] | None = None
        self._stdout_buffer = bytearray()
        try:
            # Keep this pipe binary and maintain our own line buffer. A
            # TextIOWrapper may read DONE into its userspace buffer while
            # read_until has consumed only READY, leaving select() waiting on
            # an empty kernel fd indefinitely.
            self.process = subprocess.Popen(
                [str(binary), "serve"],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                bufsize=0,
            )
            self.read_until("READY")
        except BaseException:
            self.close()
            raise

    def _take_buffered_line(self) -> str | None:
        newline = self._stdout_buffer.find(b"\n")
        if newline < 0:
            return None
        raw = bytes(self._stdout_buffer[: newline + 1])
        del self._stdout_buffer[: newline + 1]
        text = raw.decode("utf-8", errors="replace")
        self.log.write(text)
        self.log.flush()
        return text.rstrip("\r\n")

    def read_until(self, sentinel: str) -> list[str]:
        assert self.process is not None and self.process.stdout is not None
        deadline = time.monotonic() + BATCH_TIMEOUT_SECONDS
        lines: list[str] = []
        while True:
            # Drain complete userspace-buffered lines before selecting the fd.
            line = self._take_buffered_line()
            if line is not None:
                lines.append(line)
                if line == sentinel:
                    return lines
                continue
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(f"{self.label}: timed out waiting for {sentinel}")
            ready, _, _ = select.select(
                [self.process.stdout.fileno()], [], [], remaining
            )
            if not ready:
                continue
            chunk = os.read(self.process.stdout.fileno(), 65536)
            if not chunk:
                raise RuntimeError(
                    f"{self.label}: unexpected EOF, code={self.process.poll()}"
                )
            self._stdout_buffer.extend(chunk)

    def batch(
        self, mode: str, workload: str, count: int, warmup: int
    ) -> dict[str, Any]:
        assert self.process is not None and self.process.stdin is not None
        start = time.time_ns()
        self.process.stdin.write(f"batch {mode} {workload} {count} {warmup}\n".encode())
        self.process.stdin.flush()
        lines = self.read_until("DONE")
        summary = next(line for line in lines if line.startswith("R3_BATCH "))
        fields = dict(part.split("=", 1) for part in summary.split()[1:])
        samples = json.loads(
            next(line for line in lines if line.startswith("R3_SAMPLES ")).split(
                " ns=", 1
            )[1]
        )
        assert fields["mode"] == mode and fields["workload"] == workload
        assert int(fields["count"]) == count == len(samples)
        assert all(isinstance(value, int) and value > 0 for value in samples)
        return {
            "start_utc_ns": start,
            "end_utc_ns": time.time_ns(),
            "pid": self.process.pid,
            "samples_ns": samples,
            "checksum": fields["checksum"],
            "reported_mean_ns": float(fields["mean_ns"]),
        }

    def close(self) -> None:
        process = self.process
        errors: list[BaseException] = []
        try:
            if (
                process is not None
                and process.poll() is None
                and process.stdin is not None
            ):
                try:
                    process.stdin.write(b"quit\n")
                    process.stdin.flush()
                except BrokenPipeError:
                    # A renderer that exited between poll and write is already
                    # cleaned up by the wait/terminate path below.
                    pass
                except OSError as error:
                    errors.append(error)
                try:
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    pass
                except OSError as error:
                    errors.append(error)
        finally:
            if process is not None and process.poll() is None:
                try:
                    process.terminate()
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    try:
                        process.kill()
                        process.wait(timeout=10)
                    except (
                        subprocess.TimeoutExpired,
                        OSError,
                        ProcessLookupError,
                    ) as error:
                        errors.append(error)
                except (OSError, ProcessLookupError) as error:
                    errors.append(error)
            if process is not None:
                for pipe in (process.stdin, process.stdout):
                    if pipe is not None:
                        try:
                            pipe.close()
                        except OSError as error:
                            errors.append(error)
            try:
                self.log.close()
            except OSError as error:
                errors.append(error)
        if errors:
            raise RuntimeError(f"{self.label}: renderer cleanup failed") from errors[0]


def metrics(samples: dict[str, list[int]]) -> dict[str, dict[str, float]]:
    output: dict[str, dict[str, float]] = {}
    for name, index in (("mean_ns", None), ("p50_ns", 0.5), ("p95_ns", 0.95)):
        values = {}
        for label in ("A", "B"):
            ordered = sorted(samples[label])
            values[label] = (
                statistics.mean(ordered)
                if index is None
                else ordered[int(index * len(ordered))]
            )
        output[name] = {
            "a": values["A"],
            "b": values["B"],
            "delta_ns": values["B"] - values["A"],
            "relative": values["B"] / values["A"] - 1,
        }
    return output


def run_session(
    root: Path, binaries: dict[str, Path], item: dict[str, Any]
) -> dict[str, Any]:
    roles = item["physical_roles"]
    # A control retains the pseudo-R2/R3 physical assignment but launches the
    # baseline binary for both sides.
    binary_roles = {
        label: ("R2" if item["kind"] == "control" else role)
        for label, role in roles.items()
    }
    logs = root / "perprocesslogs"
    renderers: dict[str, Renderer] = {}
    session = {**item, "endpoints": {}, "processes": {}, "binary_roles": binary_roles}
    try:
        for label in item["launch_order"]:
            renderer = Renderer(
                binaries[binary_roles[label]],
                label,
                logs / f"session-{item['session']:03d}-{label}.log",
            )
            renderers[label] = renderer
            session["processes"][label] = {
                "pid": renderer.process.pid,
                "binary": binary_roles[label],
            }
        offset = item["endpoint_offset"]
        for mode, workload in ENDPOINTS[offset:] + ENDPOINTS[:offset]:
            key = f"{mode}_{workload}"
            for label in item["launch_order"]:
                renderers[label].batch(mode, workload, ENDPOINT_WARMUP_CALLS, 0)
            samples = {"A": [], "B": []}
            batches = []
            checksums = set()
            starts = [
                item["quartet_start"],
                "BAAB" if item["quartet_start"] == "ABBA" else "ABBA",
            ] * 2
            for quartet in starts:
                for label in quartet:
                    batch = renderers[label].batch(
                        mode, workload, TIMED_BATCH_CALLS, WARMUP_BATCH_CALLS
                    )
                    batches.append({"label": label, "quartet": quartet, **batch})
                    samples[label].extend(batch["samples_ns"])
                    if mode == "completed":
                        checksums.add(batch["checksum"])
            assert all(len(values) == 256 for values in samples.values())
            if mode == "completed" and len(checksums) != 1:
                raise RuntimeError(
                    f"checksum disagreement {item['session']} {key}: {checksums}"
                )
            physical_metrics = metrics(samples)
            baseline_label = next(
                label for label, role in roles.items() if role == "R2"
            )
            candidate_label = next(
                label for label, role in roles.items() if role == "R3"
            )
            logical_samples = {
                "A": samples[baseline_label],
                "B": samples[candidate_label],
            }
            session["endpoints"][key] = {
                "batches": batches,
                "physical_metrics": physical_metrics,
                "metrics": metrics(logical_samples),
            }
    finally:
        cleanup_errors: list[BaseException] = []
        for renderer in renderers.values():
            try:
                renderer.close()
            except BaseException as error:
                cleanup_errors.append(error)
        if cleanup_errors:
            session["cleanup_errors"] = [repr(error) for error in cleanup_errors]
            if sys.exc_info()[0] is None:
                raise RuntimeError("renderer cleanup failed") from cleanup_errors[0]
    return session


def campaign_root() -> Path:
    if os.environ.get("BF_R3_STAGE_DIAGNOSTICS") is not None:
        raise SystemExit("BF_R3_STAGE_DIAGNOSTICS must be unset for qualification")
    try:
        root = Path(os.environ["BF_R3_QUALIFICATION_DIR"]).resolve(strict=True)
    except KeyError as error:
        raise SystemExit(
            "BF_R3_QUALIFICATION_DIR must name a fresh campaign directory"
        ) from error
    if not root.is_dir():
        raise SystemExit("BF_R3_QUALIFICATION_DIR must be a directory")
    return root


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--validate-schedule", action="store_true")
    args = parser.parse_args()
    schedule = fixed_schedule()
    validate_schedule(schedule)
    if args.validate_schedule:
        print(json.dumps({"seed": SEED, "sessions": len(schedule), "valid": True}))
        return

    root = campaign_root()
    binaries = {"R2": root / "production-baseline", "R3": root / "production-candidate"}
    if any(not path.is_file() for path in binaries.values()):
        raise SystemExit(
            "campaign directory needs production-baseline and production-candidate binaries"
        )
    outputs = [
        root / name
        for name in (
            "fixed-protocol.json",
            "fixed-sessions.json",
            "fixed-summary.json",
            "fixed-verdict.json",
            "perprocesslogs",
        )
    ]
    if any(path.exists() for path in outputs):
        raise SystemExit("Refusing to overwrite an existing fixed campaign")
    (root / "perprocesslogs").mkdir()
    source = (
        Path(__file__).resolve().parents[1]
        / "core/render_loop/examples/r3_frame_qualification.rs"
    )
    protocol = {
        "seed": SEED,
        "groups": GROUPS,
        "sessions": len(schedule),
        "comparison_sessions": 120,
        "control_sessions": 24,
        "endpoints": [f"{mode}_{workload}" for mode, workload in ENDPOINTS],
        "endpoint_warmup_calls": ENDPOINT_WARMUP_CALLS,
        "quartets": QUARTETS,
        "priming_per_batch": WARMUP_BATCH_CALLS,
        "samples_per_batch": TIMED_BATCH_CALLS,
        "samples_per_side": 256,
        "batch_timeout_seconds": BATCH_TIMEOUT_SECONDS,
        "binary_sha256": {role: sha256(path) for role, path in binaries.items()},
        "source_sha256": sha256(source),
        "runner_source_sha256": sha256(Path(__file__).resolve()),
        "statistics_source_sha256": sha256(
            Path(__file__).resolve().with_name("r3_performance_statistics.py")
        ),
        "analysis_specification": analysis_specification(),
        "schedule": schedule,
        "started_utc_ns": time.time_ns(),
    }
    atomic_json(root / "fixed-protocol.json", protocol)
    sessions = []
    for item in schedule:
        sessions.append(run_session(root, binaries, item))
        atomic_json(root / "fixed-sessions.json", sessions)
        print(f"session {len(sessions)}/{len(schedule)} complete", flush=True)
    analysis = summarize_campaign(sessions)
    atomic_json(root / "fixed-summary.json", analysis["summary"])
    atomic_json(root / "fixed-verdict.json", analysis["verdict"])
    print(json.dumps(analysis["verdict"]), flush=True)


if __name__ == "__main__":
    main()
