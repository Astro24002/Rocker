package explainer

import "Rocker/internal/domain"

type template struct {
	reason string
	impact string
	actions []string
}

type Engine struct {
	templates map[string]template
}

func NewEngine() *Engine {
	return &Engine{
		templates: map[string]template{
			"OOM_KILLED": {
				reason: "The process exceeded its memory limit and was terminated by the kernel OOM killer.",
				impact: "Requests can fail and the service may become unstable due to repeated restarts.",
				actions: []string{"Increase container memory limit or reduce application memory usage."},
			},
			"RESTART_LOOP": {
				reason: "The container is repeatedly exiting and restarting in a short window.",
				impact: "The service is unreliable and may not remain available long enough to serve traffic.",
				actions: []string{"Inspect recent container logs and fix the startup failure before restart policy retries."},
			},
			"HEALTH_FAIL_STREAK": {
				reason: "Consecutive health checks are failing for the container.",
				impact: "The orchestrator may mark the service unhealthy and remove it from routing.",
				actions: []string{"Verify healthcheck endpoint behavior and dependency readiness."},
			},
			"NETWORK_UNREACHABLE": {
				reason: "The container is missing one or more required network attachments.",
				impact: "Service-to-service communication can fail for dependencies on missing networks.",
				actions: []string{"Attach the container to required networks in compose configuration."},
			},
			"ANONYMOUS_VOLUME": {
				reason: "The container is using anonymous volumes without explicit names.",
				impact: "Persistent data becomes harder to track, migrate, and clean up safely.",
				actions: []string{"Replace anonymous mounts with named volumes."},
			},
			"CPU_THROTTLE_HIGH": {
				reason: "The container spends a high fraction of time throttled by CPU limits.",
				impact: "Latency can increase and throughput can drop under load.",
				actions: []string{"Raise CPU quota or optimize CPU-heavy code paths."},
			},
		},
	}
}

func (e *Engine) Build(findings []domain.Finding) []domain.Explanation {
	explanations := make([]domain.Explanation, 0, len(findings))
	for _, finding := range findings {
		tpl, ok := e.templates[finding.Code]
		if !ok {
			explanations = append(explanations, domain.Explanation{
				Code:    finding.Code,
				Summary: finding.Message,
				Reason:  "No specific template exists for this finding code.",
				Impact:  "The issue may still affect service reliability and should be investigated.",
				Actions: []string{"Inspect the container logs and metrics to identify the root cause."},
				EvidenceRefs: []string{finding.Code},
			})
			continue
		}

		actions := make([]string, len(tpl.actions))
		copy(actions, tpl.actions)

		explanations = append(explanations, domain.Explanation{
			Code:         finding.Code,
			Summary:      finding.Message,
			Reason:       tpl.reason,
			Impact:       tpl.impact,
			Actions:      actions,
			EvidenceRefs: []string{finding.Code},
		})
	}
	return explanations
}
