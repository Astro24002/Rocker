package analyzer

import "Rocker/internal/domain"

const healthFailStreakThreshold = 3

type healthFailRule struct{}

func (r *healthFailRule) Name() string { return "health_fail" }

func (r *healthFailRule) Evaluate(s domain.AppGraphSnapshot) []domain.Finding {
	findings := make([]domain.Finding, 0)
	for _, c := range s.Containers {
		if c.HealthFailStreak < healthFailStreakThreshold {
			continue
		}
		findings = append(findings, domain.Finding{
			Code:    "HEALTH_FAIL_STREAK",
			Message: "container " + c.Name + " healthcheck failed 3+ times in a row",
		})
	}
	return findings
}
