#!/usr/bin/env python3

import json
import shutil
import sys
from pathlib import Path


def emit(event: dict) -> None:
    sys.stdout.write(json.dumps(event) + "\n")
    sys.stdout.flush()


def main() -> int:
    raw = sys.stdin.read().strip()
    if not raw:
        sys.stderr.write("Expected JSON request on stdin\n")
        return 1

    request = json.loads(raw)
    job_id = request["job_id"]
    output_dir = Path(request["output_dir"])
    params = request.get("params") or {}

    volume_input = None
    for item in request.get("inputs", []):
        if item.get("kind") == "volume" and item.get("path"):
            volume_input = item
            break

    if volume_input is None:
        emit(
            {
                "type": "error",
                "job_id": job_id,
                "message": "Example sidecar requires one volume input with a resolved path.",
            }
        )
        return 2

    source_path = Path(volume_input["path"])
    if not source_path.exists():
        emit(
            {
                "type": "error",
                "job_id": job_id,
                "message": f"Input path does not exist: {source_path}",
            }
        )
        return 3

    emit(
        {
            "type": "progress",
            "job_id": job_id,
            "pct": 0.2,
            "message": "Copying selected volume",
        }
    )

    output_name = f"sidecar-copy-{source_path.name}"
    copied_volume_path = output_dir / output_name
    shutil.copy2(source_path, copied_volume_path)

    emit(
        {
            "type": "progress",
            "job_id": job_id,
            "pct": 0.8,
            "message": "Writing sidecar report",
        }
    )

    report_path = output_dir / "analysis-report.json"
    report = {
        "analysis_id": "example-copy-volume-sidecar",
        "run_label": params.get("label", "Example Sidecar Run"),
        "input_name": volume_input.get("name"),
        "input_handle": volume_input.get("handle"),
        "input_path": str(source_path),
        "copied_output_path": str(copied_volume_path),
    }
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    emit(
        {
            "type": "result",
            "job_id": job_id,
            "artifacts": [
                {
                    "kind": "volume",
                    "name": f"Sidecar Copy of {volume_input.get('name') or source_path.name}",
                    "path": str(copied_volume_path),
                    "metadata": {
                        "example_sidecar": True,
                        "source_input_handle": volume_input.get("handle"),
                    },
                },
                {
                    "kind": "metadata",
                    "name": "Example Sidecar Report",
                    "path": str(report_path),
                    "metadata": {
                        "mime": "application/json",
                        "example_sidecar": True,
                    },
                },
            ],
        }
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
