package analyzer

import "Rocker/internal/domain"

type anonymousVolumeRule struct{}

func (r *anonymousVolumeRule) Name() string { return "anonymous_volume" }

func (r *anonymousVolumeRule) Evaluate(s domain.AppGraphSnapshot) []domain.Finding {
	findings := make([]domain.Finding, 0)
	for _, c := range s.Containers {
		if c.AnonymousVolumeMounts <= 0 {
			continue
		}
		findings = append(findings, domain.Finding{
			Code:    "ANONYMOUS_VOLUME",
			Message: "container " + c.Name + " uses anonymous volume mounts",
		})
	}
	return findings
}
