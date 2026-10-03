#!/usr/bin/env bash
set -euo pipefail

# Builds and zips the WXT extension for Chrome and Firefox under artifacts/.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT_DIR="${ROOT_DIR}/extension"
OUTPUT_DIR="${ROOT_DIR}/$(node "${EXT_DIR}/tools/artifact-paths.mjs" extension)"

cd "${EXT_DIR}"

# Never package leftover developer secrets from public/.
rm -f "${EXT_DIR}/public/dev-settings.json"

if [[ ! -d node_modules ]]; then
  echo "[build-extension] installing dependencies with npm ci..."
  npm ci
fi

echo "[build-extension] type-checking..."
npm exec -- wxt prepare
npm run compile

echo "[build-extension] building + zipping chrome and firefox..."
npm run zip
npm run zip:firefox

echo "[build-extension] checking artifacts for secrets / dev markers..."
chmod +x "${ROOT_DIR}/scripts/check-extension-artifacts.sh"
"${ROOT_DIR}/scripts/check-extension-artifacts.sh"

echo "[build-extension] done. Artifacts:"
ls -1 "${OUTPUT_DIR}"/*.zip
echo "[build-extension] unpacked builds: ${OUTPUT_DIR}/chrome-mv3 and firefox-mv3"
