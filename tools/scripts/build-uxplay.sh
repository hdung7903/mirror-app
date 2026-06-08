#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC_DIR="${TMPDIR:-/tmp}/uxplay-src"
OUT_DIR="${TMPDIR:-/tmp}/uxplay-out"

case "$(uname -s)" in
  Linux*) OS="linux" ;;
  Darwin*) OS="darwin" ;;
  *) echo "Unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac

case "$(uname -m)" in
  x86_64|amd64) ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *) echo "Unsupported arch: $(uname -m)" >&2; exit 1 ;;
esac

TARGET_DIR="${PROJECT_DIR}/tools/uxplay/${OS}-${ARCH}"
rm -rf "${SRC_DIR}" "${OUT_DIR}"
git clone https://github.com/FDH2/UxPlay "${SRC_DIR}"
cmake -S "${SRC_DIR}" -B "${SRC_DIR}/build" \
  -DNO_DISPLAY=1 \
  -DSTANDALONE=1 \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="${OUT_DIR}"
cmake --build "${SRC_DIR}/build" --parallel "$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 2)"
cmake --install "${SRC_DIR}/build"
mkdir -p "${TARGET_DIR}"
cp "${OUT_DIR}/bin/uxplay" "${TARGET_DIR}/uxplay"
chmod +x "${TARGET_DIR}/uxplay"
echo "UxPlay headless saved to ${TARGET_DIR}/uxplay"
