#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "native macOS runner required; Linux containers cannot provide macOS launch semantics" >&2
  exit 2
fi

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${project_root}"
npm ci
npm run dist:mac

version="$(node -p 'require("./package.json").version')"
for architecture in x64 arm64; do
  for extension in dmg zip; do
    artifact="${project_root}/release/Rocker-v${version}-${architecture}.${extension}"
    test -f "${artifact}" || {
      echo "Missing macOS artifact: ${artifact}" >&2
      exit 1
    }
  done
done

if find "${project_root}/release" -type f -name '*.blockmap' -print -quit | grep -q .; then
  echo "Unexpected blockmap in macOS release output" >&2
  exit 1
fi

echo "macOS native packaging smoke passed for Rocker v${version}"
