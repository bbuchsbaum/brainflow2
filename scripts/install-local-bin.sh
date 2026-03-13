#!/usr/bin/env bash

set -euo pipefail

SOURCE_PATH="${BASH_SOURCE[0]}"
while [[ -L "$SOURCE_PATH" ]]; do
  SOURCE_DIR="$(cd -P "$(dirname "$SOURCE_PATH")" && pwd)"
  SOURCE_PATH="$(readlink "$SOURCE_PATH")"
  if [[ "$SOURCE_PATH" != /* ]]; then
    SOURCE_PATH="${SOURCE_DIR}/${SOURCE_PATH}"
  fi
done

SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE_PATH")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

TARGET_DIR="${CARGO_TARGET_DIR:-${ROOT_DIR}/target}"
if [[ ! -d "${TARGET_DIR}" && -d "${ROOT_DIR}/src-tauri/target" ]]; then
  TARGET_DIR="${ROOT_DIR}/src-tauri/target"
fi

LOCAL_BIN_DIR="${HOME}/bin"
INSTALL_PATH="${LOCAL_BIN_DIR}/brainflow"
LAUNCHER_PATH="${ROOT_DIR}/scripts/brainflow-local"
APP_EXECUTABLE="${TARGET_DIR}/release/bundle/macos/Brainflow.app/Contents/MacOS/brainflow"

BUILD_FIRST=0
if [[ "${1:-}" == "--build" ]]; then
  BUILD_FIRST=1
elif [[ $# -gt 0 ]]; then
  echo "Usage: $0 [--build]" >&2
  exit 1
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Local ~/bin deployment is currently scripted for macOS only." >&2
  exit 1
fi

if [[ "${BUILD_FIRST}" -eq 1 ]]; then
  cd "${ROOT_DIR}"
  cargo tauri build --bundles app
fi

mkdir -p "${LOCAL_BIN_DIR}"
ln -snf "${LAUNCHER_PATH}" "${INSTALL_PATH}"

echo "Installed launcher:"
echo "  ${INSTALL_PATH}"
echo
if [[ ! -x "${APP_EXECUTABLE}" ]]; then
  echo "Release bundle is not built yet."
  echo "First launch will fail until this exists:"
  echo "  ${APP_EXECUTABLE}"
  echo
  echo "Build it with:"
  echo "  cargo tauri build --bundles app"
  echo
fi

echo "Make sure ${LOCAL_BIN_DIR} is on your PATH."
