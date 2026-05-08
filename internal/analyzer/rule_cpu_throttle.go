package analyzer

import "Rocker/internal/domain"

const cpuThrottleRatioThreshold = 0.2

type cpuThrottleRule struct{}

func (r *cpuThrottleRule) Name() string { return "cpu_throttle" }

func (r *cpuThrottleRule) Evaluate(s domain.AppGraphSnapshot) []domain.Finding {
	findings := make([]domain.Finding, 0)
	for _, c := range s.Containers {
		if c.CPUThrottleRatio < cpuThrottleRatioThreshold {
			continue
		}
		findings = append(findings, domain.Finding{
			Code:    "CPU_THROTTLE_HIGH",
			Message: "container " + c.Name + " CPU throttling ratio is >= 0.2",
		})
	}
	return findings
}
