#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_FILE="$ROOT_DIR/bundle.txt"

FILES=(
  "core/render_loop/src/lib.rs"
  "core/render_loop/src/render_state.rs"
  "core/render_loop/src/pipeline.rs"
  "core/render_loop/src/shaders.rs"
  "core/render_loop/src/shaders/slice_world_space.wgsl"
  "core/render_loop/src/shaders/slice_world_space_optimized.wgsl"
  "core/render_loop/src/optimized_renderer.rs"
  "core/api_bridge/src/lib.rs"
  "core/api_bridge/Cargo.toml"
  "ui2/src/components/panels/ClusterPanel.tsx"
  "ui2/src/services/ClusterService.ts"
  "ui2/src/stores/clusterStore.ts"
  "ui2/src/types/alphaMask.ts"
)

echo "Writing bundle to $OUTPUT_FILE"
: > "$OUTPUT_FILE"

for file in "${FILES[@]}"; do
  abs_path="$ROOT_DIR/$file"
  if [[ ! -f "$abs_path" ]]; then
    echo "Warning: $file not found, skipping" >&2
    continue
  fi

  {
    echo "# FILE: $file"
    cat "$abs_path"
    echo ""
  } >> "$OUTPUT_FILE"
done

echo "bundle.txt created with ${#FILES[@]} entries (missing files are skipped)."
