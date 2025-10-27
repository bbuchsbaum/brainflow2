#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

cd "$REPO_ROOT"

cargo check -p render_loop --features typed-shaders
cargo test -p render_loop --features typed-shaders --test typed_shaders_smoke
