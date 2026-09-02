#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
image="${ROCKER_WINDOWS_IMAGE:-rocker/windows-builder:local}"
base_image="${ROCKER_WINDOWS_BASE_IMAGE:-electronuserland/builder:24-wine@sha256:41ae540902461b6cbc988987db79547fcc10cda04d2a6c6367504f59d4b37c64}"
output_dir="${project_root}/.rocker-win-release"

docker build --pull \
  --build-arg "BUILDER_IMAGE=${base_image}" \
  -f "${project_root}/containers/windows-builder.Dockerfile" \
  -t "${image}" \
  "${project_root}"

docker run --rm \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp/rocker-home \
  -v "${project_root}:/project" \
  --tmpfs "/project/node_modules:uid=$(id -u),gid=$(id -g),mode=1777,exec" \
  "${image}" \
  bash -lc 'mkdir -p "$HOME" "$ELECTRON_CACHE" "$ELECTRON_BUILDER_CACHE" && rm -rf /project/.rocker-win-release && npm ci && rm -rf node_modules/cpu-features node_modules/nan && npm run dist:win -- --publish never -c.directories.output=/project/.rocker-win-release'

version="$(node -p 'require("./package.json").version')"
for architecture in x64 arm64; do
  artifact="${output_dir}/Rocker-v${version}-${architecture}.exe"
  test -f "${artifact}" || {
    echo "Missing Windows artifact: ${artifact}" >&2
    exit 1
  }
done

echo "Windows container packaging smoke passed for Rocker v${version}"
