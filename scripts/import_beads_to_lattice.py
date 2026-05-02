#!/usr/bin/env python3
"""Import the local beads backlog into Lattice state.

Mapping:
- beads `parent-child` edges become Lattice goals plus grouped task refs
- beads `blocks` edges become Lattice task dependencies
- beads `closed` leaf issues become `integrated` tasks
- beads `open` / `in_progress` leaf issues become `ready` if deps are satisfied,
  otherwise `draft`
- beads `tombstone` issues are skipped

This script only writes `.lattice/state/journal.db`. It does not touch source
files and is safe to rerun with `--replace`.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sqlite3
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


TASK_TABLES_TO_CLEAR = (
    "approvals",
    "checks",
    "artifacts",
    "runs",
    "tasks",
    "goals",
    "events",
    "supervisor_calls",
)

KNOWN_ROOT_PREFIXES = (
    ".github/",
    "bindings/",
    "core/",
    "docs/",
    "e2e/",
    "memory-bank/",
    "packages/",
    "plugins/",
    "schemas/",
    "scripts/",
    "src-tauri/",
    "test-data/",
    "testfiles/",
    "tools/",
    "ui2/",
    "xtask/",
    "AGENTS.md",
    "README.md",
    "Makefile",
    "Cargo.toml",
)

PATHLIKE_RE = re.compile(
    r"(?:^|[\s`'\"(])((?:\.github/|[A-Za-z0-9_.-]+/)+[A-Za-z0-9_.-]+(?:\.[A-Za-z0-9_.-]+)?)"
)
LINE_NUMBER_SUFFIX_RE = re.compile(r"(?::\d+(?::\d+)?)$")
SECTION_RE_TEMPLATE = r"(?ims)^[#]+\s*{name}\s*$\n(.*?)(?=^[#]+\s+\S|\Z)"
CODEX_PATH_PREFIXES = (
    ".github/",
    "core/",
    "scripts/",
    "src-tauri/",
    "tools/",
    "xtask/",
)
CLAUDE_PATH_PREFIXES = (
    "docs/",
    "memory-bank/",
    "ui2/",
)
CODEX_LABELS = {
    "api-bridge",
    "bridge-types",
    "ci",
    "cpu",
    "gpu",
    "remote-mount",
    "security",
    "ssh",
    "tauri",
    "testing",
}
CLAUDE_LABELS = {
    "analysis",
    "design-system",
    "frontend",
    "ingestion",
    "mosaic",
    "nftab",
    "studio",
    "ux",
    "workspace",
}
CODEX_KEYWORDS = (
    "adapter",
    "api_bridge",
    "backend",
    "benchmark",
    "cache",
    "ci",
    "differential",
    "eviction",
    "gpu",
    "pipeline",
    "readback",
    "remote mount",
    "shader",
    "ssh",
    "tauri",
    "texture",
    "upload",
    "watchdog",
)
CLAUDE_KEYWORDS = (
    "analysis workbench",
    "compare lens",
    "deck lens",
    "discovery",
    "exploration",
    "hover tooltip",
    "settings panel",
    "sparkline",
    "temporal heatmap",
    "undo/redo",
    "workspace",
)
TASK_RUNTIME_OVERRIDES = {
    "bd-20u3": "claude",
    "bd-241x": "claude",
    "bd-2e2": "claude",
    "bd-392": "claude",
    "bd-394": "claude",
    "bd-8zt": "claude",
    "bd-xwrz": "claude",
}
TASK_RUNTIME_PREFIX_OVERRIDES = (
    ("bd-2fs.", "claude"),
    ("bd-3al.", "claude"),
    ("bd-33l.", "claude"),
    ("bd-2v1.", "codex"),
    ("bd-2xd.", "codex"),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo-root",
        default=".",
        help="Repo root that contains .beads/ and .lattice/ (default: current directory).",
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Back up and clear the current Lattice journal before importing.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the import summary without modifying the Lattice journal.",
    )
    return parser.parse_args()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_timestamp(value: Any) -> str:
    if isinstance(value, str) and value.strip():
        return value
    return utc_now()


def load_beads_issues(beads_path: Path) -> dict[str, dict[str, Any]]:
    issues: dict[str, dict[str, Any]] = {}
    with beads_path.open("r", encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line:
                continue
            issue = json.loads(line)
            if issue.get("status") == "tombstone":
                continue
            issues[str(issue["id"])] = issue
    return issues


def build_children_index(issues: dict[str, dict[str, Any]]) -> dict[str, list[str]]:
    children: dict[str, list[str]] = defaultdict(list)
    for issue in issues.values():
        for dep in issue.get("dependencies", []):
            if dep.get("type") != "parent-child":
                continue
            parent_id = str(dep.get("depends_on_id") or "").strip()
            child_id = str(issue["id"])
            if parent_id and parent_id in issues:
                children[parent_id].append(child_id)
    return {parent_id: sorted(child_ids) for parent_id, child_ids in children.items()}


def find_markdown_section(text: str, section_name: str) -> str | None:
    if not text.strip():
        return None
    pattern = re.compile(SECTION_RE_TEMPLATE.format(name=re.escape(section_name)))
    match = pattern.search(text)
    if not match:
        return None
    section = match.group(1).strip()
    return section or None


def split_bullets(text: str) -> list[str]:
    items: list[str] = []
    fallback_lines: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.lower().startswith("ac:"):
            line = line[3:].strip()
        bullet_match = re.match(r"^(?:[-*+]\s+|\d+\.\s+)(?:\[[ xX]\]\s*)?(.*\S)$", line)
        if bullet_match:
            items.append(bullet_match.group(1).strip())
            continue
        checkbox_match = re.match(r"^\[(?: |x|X)\]\s*(.*\S)$", line)
        if checkbox_match:
            items.append(checkbox_match.group(1).strip())
            continue
        fallback_lines.append(line)

    if items:
        return dedupe_preserve_order(items)
    if not fallback_lines:
        return []
    collapsed = " ".join(fallback_lines).strip()
    return [collapsed] if collapsed else []


def dedupe_preserve_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value not in seen:
            seen.add(value)
            result.append(value)
    return result


def build_acceptance_criteria(issue: dict[str, Any], *, closed: bool) -> list[dict[str, Any]]:
    raw_items: list[str] = []
    acceptance_field = issue.get("acceptance_criteria")
    if isinstance(acceptance_field, list):
        raw_items.extend(str(item).strip() for item in acceptance_field if str(item).strip())
    elif isinstance(acceptance_field, str) and acceptance_field.strip():
        raw_items.extend(split_bullets(acceptance_field))

    if not raw_items:
        for source_field in ("description", "design", "notes"):
            raw_value = str(issue.get(source_field) or "")
            section = find_markdown_section(raw_value, "Acceptance Criteria")
            if section:
                raw_items.extend(split_bullets(section))
                break

    criteria: list[dict[str, Any]] = []
    status = "satisfied" if closed else "pending"
    for index, text in enumerate(dedupe_preserve_order(raw_items), start=1):
        criteria.append(
            {
                "id": f"AC-{index}",
                "text": text,
                "status": status,
                "evidence": [],
            }
        )
    return criteria


def compose_description(issue: dict[str, Any]) -> str:
    parts: list[str] = []
    labels = issue.get("labels") or []
    metadata_lines = [
        f"Imported from beads issue {issue['id']}.",
        f"Legacy status: {issue.get('status', 'unknown')}",
        f"Legacy type: {issue.get('issue_type', 'unknown')}",
    ]
    if issue.get("priority") is not None:
        metadata_lines.append(f"Priority: {issue['priority']}")
    if issue.get("assignee"):
        metadata_lines.append(f"Assignee: {issue['assignee']}")
    if issue.get("owner"):
        metadata_lines.append(f"Owner: {issue['owner']}")
    if issue.get("estimated_minutes") is not None:
        metadata_lines.append(f"Estimated minutes: {issue['estimated_minutes']}")
    if labels:
        metadata_lines.append(f"Labels: {', '.join(str(label) for label in labels)}")
    metadata_lines.append(f"Created: {normalize_timestamp(issue.get('created_at'))}")
    metadata_lines.append(f"Updated: {normalize_timestamp(issue.get('updated_at'))}")
    parts.append("\n".join(metadata_lines))

    for field_name, heading in (
        ("description", "Description"),
        ("design", "Design"),
        ("notes", "Notes"),
    ):
        value = str(issue.get(field_name) or "").strip()
        if value:
            parts.append(f"{heading}\n{value}")

    close_reason = str(issue.get("close_reason") or "").strip()
    if close_reason:
        parts.append(f"Close Reason\n{close_reason}")

    comments = issue.get("comments") or []
    if comments:
        rendered_comments: list[str] = []
        for comment in comments:
            created_at = normalize_timestamp(comment.get("created_at"))
            author = str(comment.get("author") or "unknown")
            text = str(comment.get("text") or "").strip()
            if not text:
                continue
            rendered_comments.append(f"[{created_at}] {author}\n{text}")
        if rendered_comments:
            parts.append("Comments\n" + "\n\n".join(rendered_comments))

    return "\n\n".join(part for part in parts if part.strip())


def normalize_candidate_path(candidate: str) -> str:
    value = candidate.strip().strip("`'\"()[]{}<>.,;")
    value = LINE_NUMBER_SUFFIX_RE.sub("", value)
    value = value.replace("\\", "/")
    return value


def is_touch_candidate(path_value: str, repo_root: Path) -> bool:
    if not path_value or "://" in path_value:
        return False
    if path_value.startswith("/"):
        try:
            relative = Path(path_value).resolve().relative_to(repo_root.resolve())
        except Exception:
            return False
        path_value = relative.as_posix()
    if path_value.startswith("../"):
        return False
    candidate = repo_root / path_value
    if candidate.exists():
        return True
    return any(path_value.startswith(prefix) for prefix in KNOWN_ROOT_PREFIXES)


def extract_touch_set(issue: dict[str, Any], repo_root: Path) -> list[str]:
    candidates: list[str] = []
    text_sources = [
        str(issue.get("description") or ""),
        str(issue.get("design") or ""),
        str(issue.get("notes") or ""),
    ]

    for text in text_sources:
        if not text.strip():
            continue
        files_section = find_markdown_section(text, "Files")
        if files_section:
            for line in files_section.splitlines():
                match = re.match(r"^(?:[-*+]\s+)?`?([^`\s]+(?:/[^`\s]+)*)`?", line.strip())
                if match:
                    candidates.append(match.group(1))
        for match in PATHLIKE_RE.findall(text):
            candidates.append(match)

    normalized: list[str] = []
    for raw_candidate in candidates:
        path_value = normalize_candidate_path(raw_candidate)
        if is_touch_candidate(path_value, repo_root):
            normalized.append(path_value)

    return dedupe_preserve_order(normalized)[:12]


def descendant_task_ids(
    issue_id: str,
    children_by_parent: dict[str, list[str]],
    task_ids: set[str],
) -> list[str]:
    descendants: list[str] = []
    stack = list(children_by_parent.get(issue_id, []))
    while stack:
        current = stack.pop()
        if current in task_ids:
            descendants.append(current)
            continue
        stack.extend(children_by_parent.get(current, []))
    return sorted(set(descendants))


def map_block_dependencies(
    issue: dict[str, Any],
    *,
    issues: dict[str, dict[str, Any]],
    goal_issue_ids: set[str],
    task_issue_ids: set[str],
    children_by_parent: dict[str, list[str]],
) -> list[str]:
    mapped: list[str] = []
    for dep in issue.get("dependencies", []):
        if dep.get("type") != "blocks":
            continue
        dep_id = str(dep.get("depends_on_id") or "").strip()
        if not dep_id or dep_id not in issues:
            continue
        if dep_id in task_issue_ids:
            mapped.append(dep_id)
            continue
        if dep_id in goal_issue_ids:
            mapped.extend(descendant_task_ids(dep_id, children_by_parent, task_issue_ids))
    return dedupe_preserve_order([dep_id for dep_id in mapped if dep_id != issue["id"]])


def compute_task_status(
    source_status: str,
    depends_on: list[str],
    task_rows: dict[str, dict[str, Any]],
) -> str:
    if source_status == "closed":
        return "integrated"
    if all(task_rows[dep_id]["status"] in {"verified", "integrated", "cancelled"} for dep_id in depends_on):
        return "ready"
    return "draft"


def infer_runtime(issue: dict[str, Any], touch_set: list[str]) -> str:
    issue_id = str(issue.get("id") or "").strip()
    if issue_id in TASK_RUNTIME_OVERRIDES:
        return TASK_RUNTIME_OVERRIDES[issue_id]
    for prefix, runtime in TASK_RUNTIME_PREFIX_OVERRIDES:
        if issue_id.startswith(prefix):
            return runtime

    labels = {str(label).strip().lower() for label in issue.get("labels") or []}
    issue_type = str(issue.get("issue_type") or "").strip().lower()
    text = " ".join(
        str(issue.get(field) or "")
        for field in ("title", "description", "design", "notes")
    ).lower()

    if any(path.startswith(prefix) for prefix in CODEX_PATH_PREFIXES for path in touch_set):
        return "codex"
    if labels & CODEX_LABELS:
        return "codex"
    if any(keyword in text for keyword in CODEX_KEYWORDS):
        return "codex"

    if any(path.startswith(prefix) for prefix in CLAUDE_PATH_PREFIXES for path in touch_set):
        return "claude"
    if labels & CLAUDE_LABELS:
        return "claude"
    if any(keyword in text for keyword in CLAUDE_KEYWORDS):
        return "claude"

    if issue_type == "bug":
        return "codex"
    return "claude"


def build_import_rows(repo_root: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    issues = load_beads_issues(repo_root / ".beads" / "issues.jsonl")
    children_by_parent = build_children_index(issues)
    goal_issue_ids = set(children_by_parent)
    task_issue_ids = {issue_id for issue_id in issues if issue_id not in goal_issue_ids}

    task_rows: dict[str, dict[str, Any]] = {}
    for issue_id in sorted(task_issue_ids):
        issue = issues[issue_id]
        depends_on = map_block_dependencies(
            issue,
            issues=issues,
            goal_issue_ids=goal_issue_ids,
            task_issue_ids=task_issue_ids,
            children_by_parent=children_by_parent,
        )
        source_status = str(issue.get("status") or "open")
        closed = source_status == "closed"
        touch_set = extract_touch_set(issue, repo_root)
        task_rows[issue_id] = {
            "id": issue_id,
            "title": str(issue.get("title") or issue_id),
            "description": compose_description(issue),
            "status": "integrated" if closed else "draft",
            "acceptance_criteria": build_acceptance_criteria(issue, closed=closed),
            "touch_set": touch_set,
            "depends_on": depends_on,
            "runtime": infer_runtime(issue, touch_set),
            "routing_hint": None,
            "max_budget_usd": None,
            "max_turns": None,
            "created_at": normalize_timestamp(issue.get("created_at")),
            "updated_at": normalize_timestamp(issue.get("updated_at")),
            "source_status": source_status,
        }

    for issue_id in sorted(task_rows):
        row = task_rows[issue_id]
        if row["source_status"] != "closed":
            row["status"] = compute_task_status(
                row["source_status"],
                row["depends_on"],
                task_rows,
            )

    goal_rows: list[dict[str, Any]] = []
    for issue_id in sorted(goal_issue_ids):
        issue = issues[issue_id]
        source_status = str(issue.get("status") or "open")
        goal_rows.append(
            {
                "id": f"G-{issue_id}",
                "description": compose_description(issue),
                "status": "archived" if source_status == "closed" else "active",
                "acceptance_clauses": build_acceptance_criteria(
                    issue,
                    closed=source_status == "closed",
                ),
                "task_refs": descendant_task_ids(issue_id, children_by_parent, task_issue_ids),
                "created_at": normalize_timestamp(issue.get("created_at")),
                "updated_at": normalize_timestamp(issue.get("updated_at")),
                "source_status": source_status,
                "source_issue_id": issue_id,
            }
        )

    summary = {
        "issue_count": len(issues),
        "goal_count": len(goal_rows),
        "task_count": len(task_rows),
        "task_status_counts": Counter(row["status"] for row in task_rows.values()),
        "task_runtime_counts": Counter(row["runtime"] for row in task_rows.values()),
        "goal_status_counts": Counter(row["status"] for row in goal_rows),
        "task_ids_with_dependencies": sum(1 for row in task_rows.values() if row["depends_on"]),
    }
    return list(task_rows.values()), goal_rows, summary


def ensure_lattice_journal(db_path: Path) -> None:
    if not db_path.exists():
        raise FileNotFoundError(
            f"Lattice journal not found at {db_path}. Run `lattice setup --runtime auto` first."
        )
    conn = sqlite3.connect(str(db_path))
    try:
        required_tables = {"tasks", "goals", "events", "runs"}
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        ).fetchall()
        existing_tables = {str(row[0]) for row in rows}
        missing = sorted(required_tables - existing_tables)
        if missing:
            raise RuntimeError(
                f"Lattice journal at {db_path} is missing required tables: {', '.join(missing)}"
            )
    finally:
        conn.close()


def backup_and_clear(conn: sqlite3.Connection, db_path: Path) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = db_path.with_name(f"{db_path.stem}.pre_beads_import.{timestamp}{db_path.suffix}")
    shutil.copy2(db_path, backup_path)
    for table_name in TASK_TABLES_TO_CLEAR:
        conn.execute(f"DELETE FROM {table_name}")
    conn.commit()
    return backup_path


def insert_event(
    conn: sqlite3.Connection,
    *,
    timestamp: str,
    event_type: str,
    task_id: str | None = None,
    payload: dict[str, Any] | None = None,
) -> None:
    conn.execute(
        "INSERT INTO events (timestamp, type, task_id, run_id, payload) VALUES (?, ?, ?, NULL, ?)",
        (
            timestamp,
            event_type,
            task_id,
            json.dumps(payload or {}, ensure_ascii=False),
        ),
    )


def write_import(
    *,
    db_path: Path,
    task_rows: list[dict[str, Any]],
    goal_rows: list[dict[str, Any]],
    replace: bool,
) -> Path | None:
    conn = sqlite3.connect(str(db_path))
    try:
        backup_path: Path | None = None
        if replace:
            backup_path = backup_and_clear(conn, db_path)
        else:
            existing_tasks = conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
            existing_goals = conn.execute("SELECT COUNT(*) FROM goals").fetchone()[0]
            if existing_tasks or existing_goals:
                raise RuntimeError(
                    "Lattice already has tasks or goals. Re-run with --replace to back up and overwrite state."
                )

        for row in task_rows:
            conn.execute(
                """
                INSERT INTO tasks (
                    id, title, description, status, acceptance_criteria, touch_set,
                    depends_on, runtime, routing_hint, max_budget_usd, max_turns,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    row["id"],
                    row["title"],
                    row["description"],
                    row["status"],
                    json.dumps(row["acceptance_criteria"], ensure_ascii=False),
                    json.dumps(row["touch_set"], ensure_ascii=False),
                    json.dumps(row["depends_on"], ensure_ascii=False),
                    row["runtime"],
                    row["routing_hint"],
                    row["max_budget_usd"],
                    row["max_turns"],
                    row["created_at"],
                    row["updated_at"],
                ),
            )
            insert_event(
                conn,
                timestamp=row["created_at"],
                event_type="task_created",
                task_id=row["id"],
                payload={
                    "title": row["title"],
                    "import_source": "beads",
                    "legacy_status": row["source_status"],
                },
            )
            if row["status"] != "draft":
                insert_event(
                    conn,
                    timestamp=row["updated_at"],
                    event_type="task_status_changed",
                    task_id=row["id"],
                    payload={
                        "status": row["status"],
                        "reason": f"beads_import_{row['source_status']}",
                    },
                )

        for row in goal_rows:
            conn.execute(
                """
                INSERT INTO goals (
                    id, description, status, acceptance_clauses, task_refs, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    row["id"],
                    row["description"],
                    row["status"],
                    json.dumps(row["acceptance_clauses"], ensure_ascii=False),
                    json.dumps(row["task_refs"], ensure_ascii=False),
                    row["created_at"],
                    row["updated_at"],
                ),
            )
            insert_event(
                conn,
                timestamp=row["created_at"],
                event_type="goal_created",
                payload={
                    "goal_id": row["id"],
                    "description": row["description"],
                    "import_source": "beads",
                    "source_issue_id": row["source_issue_id"],
                },
            )
            if row["status"] != "active":
                insert_event(
                    conn,
                    timestamp=row["updated_at"],
                    event_type="goal_status_changed",
                    payload={
                        "goal_id": row["id"],
                        "status": row["status"],
                        "reason": f"beads_import_{row['source_status']}",
                    },
                )

        conn.commit()
        return backup_path
    finally:
        conn.close()


def print_summary(
    *,
    repo_root: Path,
    db_path: Path,
    task_rows: list[dict[str, Any]],
    goal_rows: list[dict[str, Any]],
    summary: dict[str, Any],
    backup_path: Path | None,
    dry_run: bool,
) -> None:
    mode = "Dry run" if dry_run else "Imported"
    print(f"{mode} beads backlog into {db_path.relative_to(repo_root)}")
    print(f"  Goals: {summary['goal_count']} ({dict(summary['goal_status_counts'])})")
    print(f"  Tasks: {summary['task_count']} ({dict(summary['task_status_counts'])})")
    print(f"  Runtime mix: {dict(summary['task_runtime_counts'])}")
    print(f"  Tasks with dependency edges: {summary['task_ids_with_dependencies']}")
    if backup_path is not None:
        print(f"  Backup: {backup_path.relative_to(repo_root)}")

    ready_tasks = [row["id"] for row in task_rows if row["status"] == "ready"]
    draft_tasks = [row["id"] for row in task_rows if row["status"] == "draft"]
    active_goals = [row["id"] for row in goal_rows if row["status"] == "active"]

    if ready_tasks:
        print("  Ready tasks:")
        for task_id in ready_tasks[:12]:
            print(f"    - {task_id}")
        if len(ready_tasks) > 12:
            print(f"    - ... (+{len(ready_tasks) - 12} more)")

    if draft_tasks:
        print("  Draft tasks blocked by dependencies:")
        for task_id in draft_tasks[:12]:
            print(f"    - {task_id}")
        if len(draft_tasks) > 12:
            print(f"    - ... (+{len(draft_tasks) - 12} more)")

    if active_goals:
        print("  Active goals:")
        for goal_id in active_goals[:12]:
            print(f"    - {goal_id}")
        if len(active_goals) > 12:
            print(f"    - ... (+{len(active_goals) - 12} more)")


def main() -> int:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    db_path = repo_root / ".lattice" / "state" / "journal.db"

    try:
        ensure_lattice_journal(db_path)
        task_rows, goal_rows, summary = build_import_rows(repo_root)
        backup_path = None
        if not args.dry_run:
            backup_path = write_import(
                db_path=db_path,
                task_rows=task_rows,
                goal_rows=goal_rows,
                replace=args.replace,
            )
        print_summary(
            repo_root=repo_root,
            db_path=db_path,
            task_rows=task_rows,
            goal_rows=goal_rows,
            summary=summary,
            backup_path=backup_path,
            dry_run=args.dry_run,
        )
        return 0
    except Exception as exc:
        print(f"Import failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
