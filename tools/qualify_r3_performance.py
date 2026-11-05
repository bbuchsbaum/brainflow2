#!/usr/bin/env python3
"""Run the fixed R3 performance qualification protocol.

Build the identical r3_frame_qualification release example in R2 and R3.
Create a NEW directory containing copies named production-baseline and
production-candidate, then set BF_R3_QUALIFICATION_DIR to its absolute path.
Run this script with control first. Run comparison only if the saved control
passes. Results and raw logs stay in that directory; campaigns are never replaced.
See docs/plans/gpu-residency-implementation-2026-11.md for scope and acceptance.
"""
from pathlib import Path
import hashlib
import json
import math
import os
import statistics
import subprocess
import sys
import time

root = Path(os.environ["BF_R3_QUALIFICATION_DIR"])
if len(sys.argv) != 2 or sys.argv[1] not in ("control", "comparison"):
    raise SystemExit(
        "Usage: BF_R3_QUALIFICATION_DIR=/absolute/path python3 tools/qualify_r3_performance.py control|comparison"
    )
phase = sys.argv[1]
n_sessions = 4 if phase == "control" else 8
paths = {
    "A": root / "production-baseline",
    "B": root
    / ("production-baseline" if phase == "control" else "production-candidate"),
}
protocol = {
    "phase": phase,
    "independent_process_pair_sessions": n_sessions,
    "quartets": ["ABBA", "BAAB", "ABBA", "BAAB"],
    "samples_per_batch": 32,
    "priming_per_batch": 8,
    "endpoint_warmup_calls": 100,
    "launch_order": "AB for even-index sessions, BA for odd",
    "endpoint_order": "six endpoints rotated left by session index",
    "primary": "per-session mean public-call host submission and completed RGBA time per view",
    "secondary": "per-session pooled p50/p95 and within-session drift, descriptive",
    "replication_unit": "fresh process-pair session, not batches or frames",
    "profile": "normal release opt-z/LTO/panic-abort",
    "stop_rule": "one fixed campaign; no added sessions, discarded batches, or tolerance widening",
    "margin_relative": 0.05,
    "margin_absolute_ns": 100000,
    "binary_sha256": {
        k: hashlib.sha256(p.read_bytes()).hexdigest() for k, p in paths.items()
    },
    "started_utc_ns": time.time_ns(),
}
protocol_file = root / f"interleaved-{phase}-protocol.json"
if protocol_file.exists():
    raise SystemExit("Refusing to overwrite an existing campaign")
if phase == "comparison":
    control = json.loads((root / "interleaved-control-verdict.json").read_text())
    original = json.loads((root / "interleaved-control-protocol.json").read_text())
    if not control["all_primary_endpoints_pass"]:
        raise SystemExit("A/A sensitivity failed; candidate comparison blocked")
    if original["binary_sha256"]["A"] != protocol["binary_sha256"]["A"]:
        raise SystemExit("Baseline changed since control")
protocol_file.write_text(json.dumps(protocol, indent=2) + "\n")


class Renderer:
    def __init__(self, label, session):
        self.label = label
        self.log = (root / f"interleaved-{phase}-{session}-{label}.log").open("w")
        self.p = subprocess.Popen(
            [str(paths[label]), "serve"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        try:
            self.read_until("READY")
        except BaseException:
            self.close()
            raise

    def read_until(self, sentinel):
        lines = []
        while True:
            line = self.p.stdout.readline()
            if not line:
                raise RuntimeError(
                    f"{self.label}: unexpected EOF, code={self.p.poll()}"
                )
            self.log.write(line)
            self.log.flush()
            line = line.strip()
            lines.append(line)
            if line == sentinel:
                return lines

    def batch(self, mode, workload, count, warmup):
        start = time.time_ns()
        self.p.stdin.write(f"batch {mode} {workload} {count} {warmup}\n")
        self.p.stdin.flush()
        lines = self.read_until("DONE")
        summary = next(line for line in lines if line.startswith("R3_BATCH "))
        fields = dict(part.split("=", 1) for part in summary.split()[1:])
        sample_line = next(line for line in lines if line.startswith("R3_SAMPLES "))
        samples = json.loads(sample_line.split(" ns=", 1)[1])
        assert len(samples) == count and int(fields["count"]) == count
        assert fields["mode"] == mode and fields["workload"] == workload
        assert all(isinstance(x, int) and x > 0 for x in samples)
        return {
            "start_utc_ns": start,
            "end_utc_ns": time.time_ns(),
            "pid": self.p.pid,
            "samples_ns": samples,
            "checksum": fields["checksum"],
            "reported_mean_ns": float(fields["mean_ns"]),
        }

    def close(self):
        try:
            if self.p.poll() is None:
                self.p.stdin.write("quit\n")
                self.p.stdin.flush()
                self.p.wait(timeout=15)
        finally:
            if self.p.poll() is None:
                self.p.terminate()
                self.p.wait(timeout=10)
            self.log.close()


endpoints = [
    (mode, workload)
    for mode in ("host", "completed")
    for workload in ("steady", "property_patch", "alternating_views")
]
sessions = []
for session in range(n_sessions):
    launch_order = "AB" if session % 2 == 0 else "BA"
    renderers = {}
    data = {"launch_order": launch_order, "endpoints": {}, "processes": {}}
    try:
        for label in launch_order:
            renderers[label] = Renderer(label, session)
            data["processes"][label] = renderers[label].p.pid
        order = endpoints[session % 6 :] + endpoints[: session % 6]
        for mode, workload in order:
            key = mode + "_" + workload
            for label in launch_order:
                renderers[label].batch(mode, workload, 100, 0)
            batches = []
            samples = {"A": [], "B": []}
            hashes = set()
            for quartet in protocol["quartets"]:
                for label in quartet:
                    batch = renderers[label].batch(mode, workload, 32, 8)
                    batches.append({"label": label, "quartet": quartet, **batch})
                    samples[label].extend(batch["samples_ns"])
                    if mode == "completed":
                        hashes.add(batch["checksum"])
            if mode == "completed" and len(hashes) != 1:
                raise RuntimeError(f"checksum disagreement {key}: {hashes}")
            metrics = {}
            for metric in ("mean_ns", "p50_ns", "p95_ns"):
                values = {}
                for label in ("A", "B"):
                    ordered = sorted(samples[label])
                    assert len(ordered) == 256
                    values[label] = (
                        statistics.mean(ordered)
                        if metric == "mean_ns"
                        else ordered[
                            int((0.5 if metric == "p50_ns" else 0.95) * len(ordered))
                        ]
                    )
                a, b = values["A"], values["B"]
                metrics[metric] = {
                    "a": a,
                    "b": b,
                    "delta_ns": b - a,
                    "relative": b / a - 1,
                }
            data["endpoints"][key] = {"batches": batches, "metrics": metrics}
    finally:
        for r in renderers.values():
            r.close()
    sessions.append(data)
    (root / f"interleaved-{phase}-sessions.json").write_text(
        json.dumps(sessions, indent=2) + "\n"
    )
    print(f"{phase} session {session+1}/{n_sessions} complete", flush=True)
t95 = 2.353363435 if n_sessions == 4 else 1.894578605
t975 = 3.182446305 if n_sessions == 4 else 2.364624251
summary = {}
verdict = {}
for mode, workload in endpoints:
    key = mode + "_" + workload
    summary[key] = {}
    checks = {}
    for metric in ("mean_ns", "p50_ns", "p95_ns"):
        summary[key][metric] = {}
        for unit, limit in [("delta_ns", 100000), ("relative", 0.05)]:
            xs = [s["endpoints"][key]["metrics"][metric][unit] for s in sessions]
            mean = statistics.mean(xs)
            se = statistics.stdev(xs) / math.sqrt(n_sessions)
            lo, hi = mean - t95 * se, mean + t95 * se
            summary[key][metric][unit] = {
                "mean": mean,
                "lower95": lo,
                "upper95": hi,
                "ci_two_sided95": [mean - t975 * se, mean + t975 * se],
                "contrasts": xs,
                "launch_order_means": {
                    order: statistics.mean(
                        s["endpoints"][key]["metrics"][metric][unit]
                        for s in sessions
                        if s["launch_order"] == order
                    )
                    for order in ("AB", "BA")
                },
            }
            if metric == "mean_ns":
                checks[unit] = {
                    "passes": hi < limit and (phase != "control" or lo > -limit),
                    "lower95": lo,
                    "upper95": hi,
                    "limit": limit,
                }
    verdict[key] = {
        "checks": checks,
        "passes": all(x["passes"] for x in checks.values()),
    }
    d = summary[key]["mean_ns"]["delta_ns"]
    r = summary[key]["mean_ns"]["relative"]
    print(
        f'{key}: mean_delta_us={d["mean"]/1000:.3f} bounds95_us=[{d["lower95"]/1000:.3f},{d["upper95"]/1000:.3f}] bounds95_relative=[{r["lower95"]:.3%},{r["upper95"]:.3%}] pass={verdict[key]["passes"]}',
        flush=True,
    )
(root / f"interleaved-{phase}-summary.json").write_text(
    json.dumps(summary, indent=2) + "\n"
)
(root / f"interleaved-{phase}-verdict.json").write_text(
    json.dumps(
        {
            "all_primary_endpoints_pass": all(x["passes"] for x in verdict.values()),
            "endpoints": verdict,
        },
        indent=2,
    )
    + "\n"
)
