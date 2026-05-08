# Rocker MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single Go binary (`rocker`) that runs CLI + local Web UI in one process, parses Docker Compose, observes Docker runtime, streams topology/metrics/events, and provides rule-based runtime explanations for 3-8 service projects.

**Architecture:** Monolith single-process architecture with strict module boundaries. Runtime state is event-driven with periodic reconcile for consistency, and UI consumes a versioned snapshot model over REST + WebSocket. Explanation is rule-based (no AI) with structured evidence and actions.

**Tech Stack:** Go 1.22+, Cobra CLI, net/http, gorilla/websocket (or nhooyr/websocket), Docker Go SDK, compose-go parser, embed for UI assets, React + Vite (prebuilt static assets), Go testing package.

---

## Planned File Structure (Create/Modify Map)

### Create

- `go.mod` - module definition and dependencies.
- `cmd/rocker/main.go` - binary entrypoint.
- `internal/app/bootstrap.go` - app wiring and dependency composition.
- `internal/app/usecase_up.go` - `up` orchestration.
- `internal/domain/types.go` - core domain types.
- `internal/domain/snapshot.go` - snapshot schema and versioning.
- `internal/domain/finding.go` - finding/explanation data types.
- `internal/runtime/store.go` - in-memory state store.
- `internal/runtime/reducer.go` - event reducer.
- `internal/runtime/reconcile.go` - periodic full reconcile loop.
- `internal/runtime/builder.go` - snapshot/topology builder.
- `internal/infra/compose/loader.go` - compose loader adapter.
- `internal/infra/docker/client.go` - docker adapter entry.
- `internal/infra/docker/events.go` - event streaming adapter.
- `internal/infra/docker/inventory.go` - containers/networks/volumes inventory.
- `internal/infra/docker/stats.go` - runtime stats adapter.
- `internal/infra/cgroup/reader_linux.go` - cgroup v2 reader.
- `internal/analyzer/engine.go` - analyzer engine and registry.
- `internal/analyzer/rule_oom.go` - OOM rule.
- `internal/analyzer/rule_restart_loop.go` - restart burst rule.
- `internal/analyzer/rule_health_fail.go` - health check rule.
- `internal/analyzer/rule_network_unreachable.go` - network mismatch rule.
- `internal/analyzer/rule_anonymous_volume.go` - volume risk rule.
- `internal/analyzer/rule_cpu_throttle.go` - CPU throttling rule.
- `internal/explainer/engine.go` - finding to explanation transformer.
- `internal/server/http.go` - HTTP server bootstrap.
- `internal/server/routes.go` - REST route registration.
- `internal/server/ws_hub.go` - WebSocket hub.
- `internal/server/handlers_snapshot.go` - snapshot endpoint.
- `internal/server/handlers_runtime.go` - logs/events/restart endpoints.
- `internal/storage/snapshot_file_store.go` - JSON snapshot persistence.
- `internal/uiassets/embed.go` - `go:embed` static asset wiring.
- `web/package.json` - frontend package config.
- `web/vite.config.ts` - frontend build config.
- `web/src/main.tsx` - UI entry.
- `web/src/App.tsx` - app shell.
- `web/src/api.ts` - REST/WS client.
- `web/src/types.ts` - UI snapshot types.
- `web/src/components/ServiceList.tsx` - service state panel.
- `web/src/components/TopologyView.tsx` - topology graph panel.
- `web/src/components/MetricsPanel.tsx` - metrics cards/charts.
- `web/src/components/ExplanationPanel.tsx` - findings/explanation panel.
- `web/src/styles.css` - custom style tokens (non-generic look).
- `README.md` - usage and scope docs.
- `Makefile` - build/test/ui build helpers.

### Create Tests

- `internal/infra/compose/loader_test.go`
- `internal/runtime/reducer_test.go`
- `internal/runtime/builder_test.go`
- `internal/analyzer/rule_oom_test.go`
- `internal/analyzer/rule_restart_loop_test.go`
- `internal/analyzer/rule_health_fail_test.go`
- `internal/analyzer/rule_network_unreachable_test.go`
- `internal/analyzer/rule_anonymous_volume_test.go`
- `internal/analyzer/rule_cpu_throttle_test.go`
- `internal/explainer/engine_test.go`
- `internal/server/handlers_snapshot_test.go`
- `internal/server/ws_hub_test.go`

## Task 1: Initialize Go Module and CLI Skeleton

**Files:**
- Create: `go.mod`
- Create: `cmd/rocker/main.go`
- Create: `internal/app/bootstrap.go`
- Create: `README.md`

- [x] **Step 1: Write the failing CLI smoke test**

```go
// cmd/rocker/main_test.go
package main

import (
    "os/exec"
    "testing"
)

func TestRockerVersionCommand(t *testing.T) {
    cmd := exec.Command("go", "run", "./cmd/rocker", "version")
    out, err := cmd.CombinedOutput()
    if err != nil {
        t.Fatalf("expected version command to run, got err: %v, out: %s", err, string(out))
    }
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `go test ./cmd/rocker -run TestRockerVersionCommand -v`
Expected: FAIL with missing module/package or command implementation.

- [x] **Step 3: Write minimal implementation for CLI skeleton**

```go
// cmd/rocker/main.go
package main

import (
    "fmt"
    "os"
)

func main() {
    if len(os.Args) >= 2 && os.Args[1] == "version" {
        fmt.Println("rocker dev")
        return
    }
    if len(os.Args) >= 2 && os.Args[1] == "up" {
        fmt.Println("rocker up not yet implemented")
        return
    }
    fmt.Println("usage: rocker <up|version>")
}
```

- [x] **Step 4: Run tests to verify pass**

Run: `go test ./cmd/rocker -v`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add go.mod cmd/rocker/main.go cmd/rocker/main_test.go README.md
git commit -m "chore: initialize rocker module and CLI skeleton"
```

## Task 2: Define Domain Types and Snapshot Contract

**Files:**
- Create: `internal/domain/types.go`
- Create: `internal/domain/snapshot.go`
- Create: `internal/domain/finding.go`
- Create: `internal/runtime/builder_test.go`

- [x] **Step 1: Write failing snapshot contract test**

```go
// internal/runtime/builder_test.go
package runtime

import (
    "testing"
    "time"

    "Rocker/internal/domain"
)

func TestSnapshotHasVersionAndTimestamp(t *testing.T) {
    snap := domain.AppGraphSnapshot{
        Meta: domain.SnapshotMeta{Version: 1, GeneratedAt: time.Now().UTC()},
    }
    if snap.Meta.Version == 0 || snap.Meta.GeneratedAt.IsZero() {
        t.Fatalf("expected version and timestamp to be set")
    }
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `go test ./internal/runtime -run TestSnapshotHasVersionAndTimestamp -v`
Expected: FAIL because domain types do not exist.

- [x] **Step 3: Implement core domain contracts**

```go
// internal/domain/snapshot.go
package domain

import "time"

type SnapshotMeta struct {
    ProjectName string    `json:"projectName"`
    ComposePath string    `json:"composePath"`
    Version     uint64    `json:"version"`
    GeneratedAt time.Time `json:"generatedAt"`
}

type AppGraphSnapshot struct {
    Meta         SnapshotMeta   `json:"meta"`
    Services     []Service      `json:"services"`
    Containers   []Container    `json:"containers"`
    Networks     []Network      `json:"networks"`
    Volumes      []Volume       `json:"volumes"`
    Findings     []Finding      `json:"findings"`
    Explanations []Explanation  `json:"explanations"`
}
```

- [x] **Step 4: Run tests**

Run: `go test ./internal/runtime -v`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add internal/domain internal/runtime/builder_test.go
git commit -m "feat: define domain snapshot and finding contracts"
```

## Task 3: Compose Loader Adapter

**Files:**
- Create: `internal/infra/compose/loader.go`
- Create: `internal/infra/compose/loader_test.go`

- [x] **Step 1: Write failing compose parse test**

```go
func TestLoadComposeParsesServices(t *testing.T) {
    // temp compose with web and redis services
    // assert model.Services has 2 entries and depends_on parsed
}
```

- [x] **Step 2: Run test to confirm failure**

Run: `go test ./internal/infra/compose -v`
Expected: FAIL with undefined loader.

- [x] **Step 3: Implement minimal compose loader**

```go
type ComposeLoader interface {
    Load(path string) (domain.ComposeModel, error)
}
```

Use compose-go (or yaml unmarshal fallback for MVP) to parse:
- services
- depends_on
- networks
- volumes
- ports

- [x] **Step 4: Run tests**

Run: `go test ./internal/infra/compose -v`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add internal/infra/compose
git commit -m "feat: add compose loader adapter and tests"
```

## Task 4: Docker Inventory + Event Stream Adapters

**Files:**
- Create: `internal/infra/docker/client.go`
- Create: `internal/infra/docker/inventory.go`
- Create: `internal/infra/docker/events.go`

- [x] **Step 1: Write failing adapter compile test with interface assertions**

```go
func TestDockerAdapterImplementsRuntimeSource(t *testing.T) {
    var _ runtime.RuntimeSource = (*Client)(nil)
}
```

- [x] **Step 2: Run tests (fail expected)**

Run: `go test ./internal/infra/docker -v`
Expected: FAIL due to missing RuntimeSource methods.

- [x] **Step 3: Implement Docker client and required methods**

Implement methods:
- `ListContainers(ctx)`
- `ListNetworks(ctx)`
- `ListVolumes(ctx)`
- `StreamEvents(ctx)`
- `ContainerLogs(ctx, id, tail)`
- `RestartContainer(ctx, id)`

- [x] **Step 4: Run tests**

Run: `go test ./internal/infra/docker -v`
Expected: PASS for compile/interface tests.

- [x] **Step 5: Commit**

```bash
git add internal/infra/docker
git commit -m "feat: add docker runtime source adapters"
```

## Task 5: Runtime Store, Reducer, Reconcile Loop

**Files:**
- Create: `internal/runtime/store.go`
- Create: `internal/runtime/reducer.go`
- Create: `internal/runtime/reconcile.go`
- Create: `internal/runtime/reducer_test.go`

- [x] **Step 1: Write failing reducer test for container lifecycle**

```go
func TestReducerUpdatesContainerStateOnStartStop(t *testing.T) {
    // apply start event then stop event
    // assert container state transitions running -> exited
}
```

- [x] **Step 2: Run test (fail expected)**

Run: `go test ./internal/runtime -run TestReducerUpdatesContainerStateOnStartStop -v`
Expected: FAIL.

- [x] **Step 3: Implement store + reducer + reconcile skeleton**

Key behavior:
- Single writer mutation path
- Version increments on each committed state change
- Reconcile replaces/merges stale entities

- [x] **Step 4: Run runtime tests**

Run: `go test ./internal/runtime -v`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add internal/runtime
git commit -m "feat: implement runtime state reducer and reconcile loop"
```

## Task 6: Snapshot Builder and File Persistence

**Files:**
- Create: `internal/runtime/builder.go`
- Create: `internal/storage/snapshot_file_store.go`
- Create: `internal/server/handlers_snapshot_test.go`

- [x] **Step 1: Write failing test for snapshot save/load roundtrip**

```go
func TestSnapshotFileStoreRoundTrip(t *testing.T) {
    // save snapshot
    // load latest
    // assert key fields equal
}
```

- [x] **Step 2: Run tests (fail expected)**

Run: `go test ./internal/storage -v`
Expected: FAIL.

- [x] **Step 3: Implement builder + JSON file snapshot store**

Store path convention:
- `.rocker/snapshots/latest.json`

Builder responsibilities:
- merge compose model + runtime state
- stamp `meta.version` and `generatedAt`

- [x] **Step 4: Run tests**

Run: `go test ./internal/storage ./internal/runtime -v`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add internal/runtime/builder.go internal/storage
git commit -m "feat: build versioned snapshots and local persistence"
```

## Task 7: Analyzer Rules Engine (6 MVP Rules)

**Files:**
- Create: `internal/analyzer/engine.go`
- Create: `internal/analyzer/rule_oom.go`
- Create: `internal/analyzer/rule_restart_loop.go`
- Create: `internal/analyzer/rule_health_fail.go`
- Create: `internal/analyzer/rule_network_unreachable.go`
- Create: `internal/analyzer/rule_anonymous_volume.go`
- Create: `internal/analyzer/rule_cpu_throttle.go`
- Create tests listed in file map above

- [x] **Step 1: Write failing tests for all six rules**

```go
func TestOOMRuleCreatesCriticalFinding(t *testing.T) {}
func TestRestartLoopRuleCreatesWarningFinding(t *testing.T) {}
func TestHealthFailRuleCreatesWarningFinding(t *testing.T) {}
func TestNetworkRuleCreatesWarningFinding(t *testing.T) {}
func TestAnonymousVolumeRuleCreatesWarningFinding(t *testing.T) {}
func TestCPUThrottleRuleCreatesWarningFinding(t *testing.T) {}
```

- [x] **Step 2: Run analyzer tests (fail expected)**

Run: `go test ./internal/analyzer -v`
Expected: FAIL.

- [x] **Step 3: Implement analyzer engine + rule registry**

```go
type Rule interface {
    Name() string
    Evaluate(s domain.AppGraphSnapshot) []domain.Finding
}
```

- [x] **Step 4: Implement each rule minimally to satisfy tests**

Threshold defaults:
- restart burst: >= 5 in 5 minutes
- health fail streak: >= 3
- cpu throttling ratio: >= 0.2 over window

- [x] **Step 5: Run tests**

Run: `go test ./internal/analyzer -v`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add internal/analyzer
git commit -m "feat: add rule-based analyzer for runtime failures"
```

## Task 8: Explanation Engine

**Files:**
- Create: `internal/explainer/engine.go`
- Create: `internal/explainer/engine_test.go`

- [x] **Step 1: Write failing explanation format test**

```go
func TestExplainerBuildsReasonImpactActions(t *testing.T) {
    // given finding OOM
    // expect reason, impact, >=1 action, evidence refs
}
```

- [x] **Step 2: Run tests (fail expected)**

Run: `go test ./internal/explainer -v`
Expected: FAIL.

- [x] **Step 3: Implement explainer mapping templates**

Template output keys:
- reason
- impact
- actions
- evidenceRefs

- [x] **Step 4: Run tests**

Run: `go test ./internal/explainer -v`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add internal/explainer
git commit -m "feat: add structured explanation engine"
```

## Task 9: HTTP API + WebSocket Server

**Files:**
- Create: `internal/server/http.go`
- Create: `internal/server/routes.go`
- Create: `internal/server/ws_hub.go`
- Create: `internal/server/handlers_snapshot.go`
- Create: `internal/server/handlers_runtime.go`
- Create: `internal/server/handlers_snapshot_test.go`
- Create: `internal/server/ws_hub_test.go`

- [x] **Step 1: Write failing API tests for `/api/v1/snapshot` and WS init message**

```go
func TestSnapshotHandlerReturnsJSON(t *testing.T) {}
func TestWSHubBroadcastsSnapshotInit(t *testing.T) {}
```

- [x] **Step 2: Run server tests (fail expected)**

Run: `go test ./internal/server -v`
Expected: FAIL.

- [x] **Step 3: Implement HTTP routes and handlers**

Endpoints:
- `GET /api/v1/projects/current`
- `GET /api/v1/snapshot`
- `GET /api/v1/services/:name/logs?tail=200`
- `POST /api/v1/containers/:id/restart`
- `GET /api/v1/events?since=<ts>`

- [x] **Step 4: Implement WebSocket hub and message types**

Message kinds:
- `snapshot.init`
- `snapshot.patch`
- `finding.updated`

- [x] **Step 5: Run tests**

Run: `go test ./internal/server -v`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add internal/server
git commit -m "feat: add API and websocket realtime delivery"
```

## Task 10: CLI `up` Use Case Wiring

**Files:**
- Create: `internal/app/usecase_up.go`
- Modify: `cmd/rocker/main.go`
- Modify: `internal/app/bootstrap.go`

- [x] **Step 1: Write failing integration-like test for `rocker up --compose` startup**

```go
func TestUpCommandValidatesComposeFlag(t *testing.T) {
    // run command without compose path
    // expect non-zero and clear error message
}
```

- [x] **Step 2: Run test (fail expected)**

Run: `go test ./cmd/rocker -run TestUpCommandValidatesComposeFlag -v`
Expected: FAIL.

- [x] **Step 3: Implement `up` orchestration and dependency wiring**

Behavior:
- parse compose path
- load compose
- initialize runtime state
- start background loops
- start HTTP server

- [x] **Step 4: Run tests**

Run: `go test ./cmd/rocker ./internal/app -v`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add cmd/rocker internal/app
git commit -m "feat: wire up rocker up command runtime orchestration"
```

## Task 11: Frontend UI and Embedded Assets

**Files:**
- Create: `web/package.json`
- Create: `web/vite.config.ts`
- Create: `web/src/main.tsx`
- Create: `web/src/App.tsx`
- Create: `web/src/api.ts`
- Create: `web/src/types.ts`
- Create: `web/src/components/ServiceList.tsx`
- Create: `web/src/components/TopologyView.tsx`
- Create: `web/src/components/MetricsPanel.tsx`
- Create: `web/src/components/ExplanationPanel.tsx`
- Create: `web/src/styles.css`
- Create: `internal/uiassets/embed.go`

- [x] **Step 1: Write failing frontend smoke checks**

Add simple script checks in `package.json`:

```json
{
  "scripts": {
    "build": "vite build",
    "typecheck": "tsc --noEmit"
  }
}
```

Run typecheck before files exist to force initial failure.

- [x] **Step 2: Run checks (fail expected)**

Run: `npm --prefix web run typecheck`
Expected: FAIL.

- [x] **Step 3: Implement MVP UI modules**

UI requirements:
- service runtime status list
- topology view (basic graph)
- metrics cards
- findings/explanations panel
- websocket live refresh

Style requirements:
- use CSS variables in `web/src/styles.css`
- avoid generic default visual style

- [x] **Step 4: Embed built assets into Go binary**

Build UI to `web/dist`, embed via `//go:embed` and serve from `internal/server`.

- [x] **Step 5: Run checks**

Run: `npm --prefix web run typecheck && npm --prefix web run build`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add web internal/uiassets
git commit -m "feat: add embedded local web UI for runtime visualization"
```

## Task 12: Linux cgroup Reader and Metrics Poller

**Files:**
- Create: `internal/infra/cgroup/reader_linux.go`
- Modify: `internal/infra/docker/stats.go`
- Modify: `internal/runtime/reconcile.go`

- [x] **Step 1: Write failing metrics mapping test**

```go
func TestMetricsSampleIncludesCPUAndMemory(t *testing.T) {}
```

- [x] **Step 2: Run tests (fail expected)**

Run: `go test ./internal/infra/cgroup ./internal/infra/docker -v`
Expected: FAIL.

- [x] **Step 3: Implement cgroup v2 metrics reader and polling integration**

Collect:
- CPU usage
- memory usage
- IO bytes
- throttling counters

- [x] **Step 4: Run tests**

Run: `go test ./internal/infra/cgroup ./internal/infra/docker ./internal/runtime -v`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add internal/infra/cgroup internal/infra/docker/stats.go internal/runtime/reconcile.go
git commit -m "feat: collect container metrics from docker and cgroup v2"
```

## Task 13: Error Model, Logging, and Recovery

**Files:**
- Modify: `internal/server/handlers_runtime.go`
- Modify: `internal/app/usecase_up.go`
- Create: `internal/domain/errors.go`

- [x] **Step 1: Write failing error contract tests**

```go
func TestAPIErrorBodyIncludesCodeAndRetryable(t *testing.T) {}
```

- [x] **Step 2: Run tests (fail expected)**

Run: `go test ./internal/server -run TestAPIErrorBodyIncludesCodeAndRetryable -v`
Expected: FAIL.

- [x] **Step 3: Implement standardized error model**

Required error codes:
- `COMPOSE_INVALID`
- `DOCKER_UNREACHABLE`
- `CGROUP_UNAVAILABLE`
- `INSUFFICIENT_PERMISSION`

- [x] **Step 4: Add Docker reconnect behavior path**

Implement retry loop with backoff and event stream re-subscription.

- [x] **Step 5: Run tests**

Run: `go test ./internal/server ./internal/app -v`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add internal/domain/errors.go internal/server internal/app
git commit -m "feat: add standardized runtime errors and reconnect handling"
```

## Task 14: Build Tooling and Documentation

**Files:**
- Create: `Makefile`
- Modify: `README.md`

- [x] **Step 1: Write failing doc/command sanity check**

Add a `make help` target and test command exists.

- [x] **Step 2: Run command (fail expected)**

Run: `make help`
Expected: FAIL before Makefile exists.

- [x] **Step 3: Implement Makefile targets and docs**

Targets:
- `make test`
- `make ui-build`
- `make build`
- `make run`

README sections:
- install/build
- `rocker up --compose`
- supported scope and limits
- troubleshooting

- [x] **Step 4: Run verification commands**

Run: `make test && make ui-build && make build`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add Makefile README.md
git commit -m "docs: add build workflow and MVP usage guide"
```

## Task 15: End-to-End MVP Acceptance Validation

**Files:**
- Modify: `README.md` (append acceptance runbook)

- [x] **Step 1: Prepare local compose fixture for validation**

Create temporary compose fixture with 4 services: web/api/redis/mysql.

- [x] **Step 2: Execute acceptance scenario 1 (topology render)**

Run: `./rocker up --compose ./fixtures/compose-4svc.yml`
Expected: UI shows 4 services and dependencies.

- [x] **Step 3: Execute acceptance scenario 2/3/4**

Validate:
- Redis OOM finding/explanation
- Anonymous volume risk
- Network unreachable finding

- [x] **Step 4: Execute acceptance scenario 5**

Restart Docker daemon and verify reconnection/resume.

- [x] **Step 5: Final verification command suite**

Run: `go test ./... && npm --prefix web run build && go build -o rocker ./cmd/rocker`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add README.md
git commit -m "test: validate MVP acceptance scenarios and runbook"
```

## Spec Coverage Check

- Single Go binary with CLI + local Web UI: covered by Tasks 1, 10, 11, 14.
- Compose import and topology snapshot model: covered by Tasks 2, 3, 6.
- Runtime events/reconcile consistency: covered by Tasks 4, 5.
- Metrics (CPU/memory/IO/network) and cgroup usage: covered by Task 12.
- Rule-based explain engine (6 rules): covered by Tasks 7 and 8.
- API + WebSocket contract: covered by Task 9.
- Error semantics and reconnect behavior: covered by Task 13.
- MVP acceptance criteria and operational runbook: covered by Task 15.

No spec gaps found for MVP v1 scope.

## Placeholder/Consistency Check

- Placeholder scan result: no `TODO`, `TBD`, or unresolved markers.
- Type naming consistency: `AppGraphSnapshot`, `Finding`, `Explanation`, and API routes are consistent across tasks.
- Scope consistency: remains single-host, 3-8 service Compose projects.
