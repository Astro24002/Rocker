package analyzer

import (
	"time"

	"Rocker/internal/domain"
)

const restartBurstThreshold = 5

type restartLoopRule struct {
	now func() time.Time
}

func newRestartLoopRule() *restartLoopRule {
	return &restartLoopRule{now: func() time.Time { return time.Now().UTC() }}
}

func (r *restartLoopRule) Name() string { return "restart_loop" }

func (r *restartLoopRule) Evaluate(s domain.AppGraphSnapshot) []domain.Finding {
	findings := make([]domain.Finding, 0)
	cutoff := r.now().Add(-5 * time.Minute)
	for _, c := range s.Containers {
		if c.RestartCount < restartBurstThreshold {
			continue
		}
		if c.LastStartedAt.Before(cutoff) {
			continue
		}
		findings = append(findings, domain.Finding{
			Code:    "RESTART_LOOP",
			Message: "container " + c.Name + " restarted 5 times within 5 minutes",
		})
	}
	return findings
}
