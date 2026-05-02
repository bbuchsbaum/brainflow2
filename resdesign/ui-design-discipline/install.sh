#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Install ui-design-discipline skill.

Usage:
  ./install.sh codex-project [repo-root]
  ./install.sh claude-project [repo-root]
  ./install.sh claude-user

Examples:
  ./install.sh codex-project .
  ./install.sh claude-project .
  ./install.sh claude-user
EOF
}

MODE="${1:-}"
ROOT="${2:-.}"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "$MODE" in
  codex-project)
    TARGET="$ROOT/.agents/skills/ui-design-discipline"
    mkdir -p "$(dirname "$TARGET")"
    rm -rf "$TARGET"
    cp -R "$SOURCE_DIR" "$TARGET"
    echo "Installed to $TARGET"
    ;;
  claude-project)
    TARGET="$ROOT/.claude/skills/ui-design-discipline"
    mkdir -p "$(dirname "$TARGET")"
    rm -rf "$TARGET"
    cp -R "$SOURCE_DIR" "$TARGET"
    echo "Installed to $TARGET"
    ;;
  claude-user)
    TARGET="$HOME/.claude/skills/ui-design-discipline"
    mkdir -p "$(dirname "$TARGET")"
    rm -rf "$TARGET"
    cp -R "$SOURCE_DIR" "$TARGET"
    echo "Installed to $TARGET"
    ;;
  *)
    usage
    exit 1
    ;;
esac
