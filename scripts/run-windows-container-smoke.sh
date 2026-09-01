#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
image="${ROCKER_WINDOWS_IMAGE:-rocker/windows-builder:local}"
base_image="${ROCKER_WINDOWS_BASE_IMAGE:-electronuserland/builder:24-wine}"

docker build --pull \
  --build-arg "BUILDER_IMAGE=${base_image}" \
  -f "${project_root}/containers/windows-builder.Dockerfile" \
  -t "${image}" \
  "${project_root}"

docker run --rm \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp/rocker-home \
  -v "${project_root}:/project" \
  "${image}" \
  bash -lc 'mkdir -p "$HOME" "$ELECTRON_CACHE" "$ELECTRON_BUILDER_CACHE" && npm ci && npm run dist:win'

version="$(node -p 'require("./package.json").version')"
for architecture in x64 arm64; do
  artifact="${project_root}/release/Rocker-v${version}-${architecture}.exe"
  test -f "${artifact}" || {
    echo "Missing Windows artifact: ${artifact}" >&2
    exit 1
  }
done

if find "${project_root}/release" -type f -name '*.blockmap' -print -quit | grep -q .; then
  echo "Unexpected blockmap in Windows release output" >&2
  exit 1
fi

echo "Windows container packaging smoke passed for Rocker v${version}"
