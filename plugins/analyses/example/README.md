# Example Analysis Plugin

This folder contains a small runnable sidecar analysis for the host analysis
protocol.

What it does:
- accepts a single volume input
- copies that volume into the job output directory
- writes `analysis-report.json`
- emits `progress` and final `result` events over stdout NDJSON

It is intentionally simple. The point is to give the Analysis Workbench a real
sidecar path that can be discovered and run without extra setup.

Protocol details live in [docs/analysis_plugins.md](../../../docs/analysis_plugins.md).
