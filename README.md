# Rocker

Minimal CLI skeleton for Rocker.

## Install / Build

Build the binary:

`go build -o rocker ./cmd/rocker`

Build frontend assets:

`npm --prefix web install && npm --prefix web run build`

Or use:

`make ui-build`

## Usage

`go run ./cmd/rocker version`

`go run ./cmd/rocker up --compose ./compose.yml`

`make run`

## Scope and Limits

- MVP targets local single-host Docker Compose projects.
- Current development scope is 3-8 services.
- Runtime diagnostics are rule-based (no AI diagnosis in MVP).

## Troubleshooting

- If frontend checks fail, run `npm --prefix web install` first.
- If `internal/uiassets` embed fails, rebuild frontend and copy assets into `internal/uiassets/dist`.
- If `make` command is unavailable in your environment, run the equivalent shell commands manually.

## Acceptance Runbook (MVP)

1. Prepare fixture compose:
   - use `./fixtures/compose-4svc.yml` (web/api/redis/mysql).
2. Start runtime:
   - run `./rocker up --compose ./fixtures/compose-4svc.yml`.
3. Validate topology:
   - confirm UI shows all four services and expected dependencies.
4. Validate diagnostic scenarios:
   - Redis OOM should surface a finding + explanation.
   - anonymous volume should trigger persistence risk warning.
   - network mismatch should produce network-unreachable finding.
5. Validate resiliency:
   - restart Docker daemon; confirm stream reconnect path resumes.
6. Final quality gate:
   - run `go test ./... && npm --prefix web run build && go build -o rocker ./cmd/rocker`.
