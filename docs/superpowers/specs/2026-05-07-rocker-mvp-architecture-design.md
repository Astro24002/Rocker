# Rocker MVP Technical Architecture Design (v1)

Date: 2026-05-07
Status: Draft approved in conversation, documented for implementation planning

## 1. Project Positioning

Rocker is a runtime understanding platform for Docker Compose projects.

Its MVP goal is not container orchestration replacement, but runtime visibility and explanation:

- Make runtime topology visible.
- Make failures understandable.
- Make root-cause reasoning actionable for developers.

One-line definition:

> Rocker is a single-binary local runtime intelligence layer that helps developers truly understand how Docker Compose applications run.

## 2. MVP Scope and Constraints

### In Scope

- Single Go binary output (`rocker`).
- Runtime mode: CLI + local Web UI from same process.
- Target project size: 3-8 services per Compose app.
- Local single-host Docker Engine only.
- Core capability set:
  - Compose import and runtime topology
  - Runtime status and event stream
  - Basic metrics (CPU, memory, IO, network)
  - Storage visibility and persistence risk hints
  - Rule-based runtime explanation

### Out of Scope (MVP)

- Multi-node deployment/aggregation
- AI/LLM diagnosis
- Kubernetes control or migration automation
- Multi-tenant auth/RBAC
- Swarm/K8s runtime control

## 3. Chosen Architecture

Selected approach: **Monolith single-process all-in-one (Option A)**.

Why:

- Fastest path to MVP.
- Best fit for single-binary constraint.
- Lowest deployment and operational complexity.
- Easiest local troubleshooting loop.

Design principle: monolith runtime with strict internal module boundaries and interface-first contracts.

## 4. System Layers

### Presentation Layer

- CLI commands
- HTTP REST API
- WebSocket realtime stream
- Local Web UI static assets

### Application Layer

- Use-case orchestration:
  - load project
  - watch runtime
  - build snapshots
  - run analysis and explanation

### Domain Layer

- Core models and rules:
  - application/service/container/network/volume
  - runtime events
  - metric samples
  - findings/explanations

### Infrastructure Layer

- Docker SDK adapters
- Compose parser adapter
- cgroup reader
- local snapshot persistence

## 5. Repository and Package Blueprint

```text
cmd/rocker
internal/app
internal/domain
internal/runtime
internal/analyzer
internal/explainer
internal/server
internal/uiassets
internal/storage
internal/infra/docker
internal/infra/compose
internal/infra/cgroup
```

Module responsibilities:

- `cmd/rocker`: process entry, config wiring, subcommands.
- `internal/app`: application services/use-case orchestration.
- `internal/domain`: pure entities/value objects/rules.
- `internal/runtime`: in-memory state store, reducers, reconciliation.
- `internal/analyzer`: finding detectors.
- `internal/explainer`: user-facing reason/action generation.
- `internal/server`: REST/WS/static web serving.
- `internal/uiassets`: embedded frontend build artifacts.
- `internal/storage`: lightweight local persistence.
- `internal/infra/*`: all external runtime integrations.

## 6. Core Runtime Flow

### Startup

1. `rocker up --compose <path>`
2. Parse Compose into normalized model.
3. Pull current docker runtime state.
4. Build initial `AppGraphSnapshot`.
5. Start API/UI server.
6. Start event, metrics, and reconcile loops.

### Realtime Loop

1. Docker events received.
2. Reducer updates in-memory runtime state.
3. Topology/snapshot recomputed (incremental where possible).
4. Analyzer emits findings.
5. Explainer emits human-readable explanations.
6. WS pushes init/patch to UI.

### Consistency Strategy

- Event-driven updates for low latency.
- Periodic full reconcile (15-30s) for drift correction.
- Snapshot versioning for deterministic frontend refresh.

## 7. Key Interfaces (Contracts First)

- `ComposeLoader`: `Load(path) (ComposeModel, error)`
- `RuntimeSource`: list containers/networks/volumes, stream events, fetch stats
- `TopologyBuilder`: `Build(compose, runtimeState) (AppGraphSnapshot, error)`
- `Analyzer`: `Analyze(snapshot) ([]Finding, error)`
- `Explainer`: `Explain(findings, snapshot) ([]Explanation, error)`
- `SnapshotStore`: save/load latest snapshots

These contracts enable internal refactor and future architecture evolution without breaking feature behavior.

## 8. Concurrency Model

- `event-consumer` goroutine: ingest and reduce runtime events.
- `metrics-poller` goroutine: sample per-container metrics at configurable interval.
- `reconcile-loop` goroutine: periodic full state sync.
- `broadcast-hub` goroutine: WebSocket fanout and backpressure handling.

Rule: serialize state mutation through reducer path; serve reads from immutable snapshot copies.

## 9. API and WebSocket Design

### REST Endpoints (MVP)

- `GET /api/v1/projects/current`
- `GET /api/v1/snapshot`
- `GET /api/v1/services/:name/logs?tail=200`
- `POST /api/v1/containers/:id/restart`
- `GET /api/v1/events?since=<ts>`

### WebSocket

- Endpoint: `/api/v1/ws`
- Message types:
  - `snapshot.init` (full)
  - `snapshot.patch` (delta)
  - `event.runtime` (optional raw event stream)
  - `finding.updated`

Reconnect behavior: client re-pulls `/snapshot` before resuming patch stream.

## 10. Runtime Explain Engine (Rule-Based MVP)

Output format per explanation:

- `reason`
- `impact`
- `actions[]`
- `evidenceRefs[]`

Initial rule set:

1. OOMKilled
2. Restart loop burst
3. Healthcheck continuous failure
4. Network unreachable/mismatch
5. Anonymous volume data-loss risk
6. CPU throttling sustained

Each finding includes category, severity, resource reference, evidence, confidence, and lifecycle timestamps.

## 11. Non-Functional Targets (MVP)

- Initial snapshot load: < 2s (3-8 services)
- Event-to-UI latency: < 1s (local host)
- Memory footprint: < 250MB steady state
- Agent CPU overhead: < 5% average on dev machine
- Docker daemon reconnect: automatic recovery

## 12. MVP Acceptance Criteria

1. Import a 4-service compose project; topology/dependencies render correctly.
2. Simulate Redis OOM; explanation appears with evidence and actions.
3. Database service on anonymous volume triggers persistence risk warning.
4. Break network relationship; network-unreachable finding appears.
5. Restart Docker daemon; Rocker reconnects and resumes updates.

## 13. Two-Week Execution Plan

### Week 1: Visibility Path

- Day 1: project skeleton, config, logging, error codes
- Day 2: compose parser + docker inventory + first snapshot
- Day 3: event reducer + reconcile loop
- Day 4: snapshot API + WS init/patch
- Day 5: UI v0 (service list, topology, status)

### Week 2: Understanding Path

- Day 6: metrics poller + aggregation
- Day 7: OOM/restart/health analyzer rules
- Day 8: network/storage analyzer rules
- Day 9: explanation templates + UI explanation panel
- Day 10: reliability pass, perf check, release binary

Milestones:

- `v0.1`: topology + state + events
- `v0.2`: metrics + first 3 explain rules
- `v0.3`: all 6 rules + hardening + packaged binary

## 14. Risks and Mitigations

- Event disorder/loss: periodic reconcile as source-of-truth correction.
- cgroup portability variance: MVP focus on Linux cgroup v2; unsupported platforms degrade gracefully.
- Graph rendering complexity: fixed/simple layout first.
- False positives in diagnosis: conservative thresholds + confidence field.
- Performance pressure: adaptive sampling + delta coalescing.

## 15. Evolution Path After MVP

- Phase 2: richer failure analysis and optional AI assistant.
- Phase 3: Compose-to-K8s conceptual mapping mode.
- Phase 4: multi-node agent federation and cloud runtime view.

---

This document is the baseline architecture contract for implementation planning.
