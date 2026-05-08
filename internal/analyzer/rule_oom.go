package analyzer

import "Rocker/internal/domain"

type oomRule struct{}

func (r *oomRule) Name() string { return "oom" }

func (r *oomRule) Evaluate(s domain.AppGraphSnapshot) []domain.Finding {
	findings := make([]domain.Finding, 0)
	for _, c := range s.Containers {
		if !c.OOMKilled {
			continue
		}
		findings = append(findings, domain.Finding{
			Code:    "OOM_KILLED",
			Message: "container " + c.Name + " was OOM-killed",
		})
	}
	return findings
}
