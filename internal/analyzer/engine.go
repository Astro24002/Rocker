package analyzer

import "Rocker/internal/domain"

type Rule interface {
	Name() string
	Evaluate(s domain.AppGraphSnapshot) []domain.Finding
}

type Engine struct {
	rules []Rule
}

func NewEngine() *Engine {
	return &Engine{
		rules: []Rule{
			&oomRule{},
			newRestartLoopRule(),
			&healthFailRule{},
			&networkUnreachableRule{},
			&anonymousVolumeRule{},
			&cpuThrottleRule{},
		},
	}
}

func (e *Engine) Analyze(s domain.AppGraphSnapshot) []domain.Finding {
	findings := make([]domain.Finding, 0)
	for _, rule := range e.rules {
		findings = append(findings, rule.Evaluate(s)...)
	}
	return findings
}
