package analyzer

import "Rocker/internal/domain"

type networkUnreachableRule struct{}

func (r *networkUnreachableRule) Name() string { return "network_unreachable" }

func (r *networkUnreachableRule) Evaluate(s domain.AppGraphSnapshot) []domain.Finding {
	findings := make([]domain.Finding, 0)
	for _, c := range s.Containers {
		if len(c.DesiredNetworks) == 0 {
			continue
		}
		if isSubset(c.DesiredNetworks, c.AttachedNetworks) {
			continue
		}
		findings = append(findings, domain.Finding{
			Code:    "NETWORK_UNREACHABLE",
			Message: "container " + c.Name + " is missing required network attachment",
		})
	}
	return findings
}

func isSubset(need []string, have []string) bool {
	haveSet := make(map[string]struct{}, len(have))
	for _, name := range have {
		haveSet[name] = struct{}{}
	}
	for _, name := range need {
		if _, ok := haveSet[name]; !ok {
			return false
		}
	}
	return true
}
