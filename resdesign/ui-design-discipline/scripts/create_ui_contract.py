#!/usr/bin/env python3
"""Create a starter UI design-system contract if one does not already exist."""

from __future__ import annotations

import argparse
from datetime import date
from pathlib import Path

TEMPLATE_CANDIDATES = [
    Path(__file__).resolve().parents[1] / "assets" / "ui-contract.template.md",
]


def main() -> int:
    parser = argparse.ArgumentParser(description="Create docs/design-system/ui-contract.md from bundled template.")
    parser.add_argument("--root", default=".", help="Repository root")
    parser.add_argument("--force", action="store_true", help="Overwrite existing contract after creating a .bak file")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    target_dir = root / "docs" / "design-system"
    target = target_dir / "ui-contract.md"

    template_path = next((p for p in TEMPLATE_CANDIDATES if p.exists()), None)
    if not template_path:
        raise SystemExit("Could not find ui-contract.template.md")

    target_dir.mkdir(parents=True, exist_ok=True)

    if target.exists() and not args.force:
        print(f"Contract already exists: {target}")
        print("Use --force to overwrite after creating a backup.")
        return 0

    if target.exists() and args.force:
        backup = target.with_suffix(target.suffix + ".bak")
        backup.write_text(target.read_text(encoding="utf-8"), encoding="utf-8")
        print(f"Backed up existing contract to {backup}")

    content = template_path.read_text(encoding="utf-8").replace("{{DATE}}", date.today().isoformat())
    target.write_text(content, encoding="utf-8")
    print(f"Created {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
