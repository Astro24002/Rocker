package analyzer

import (
	"testing"
	"time"

	"Rocker/internal/domain"
)

func TestEngineAggregatesFindingsAcrossRules(t *testing.T) {
	now := time.Now().UTC()
	engine := NewEngine()

	snapshot := domain.AppGraphSnapshot{
		Containers: []domain.Container{
			{
				Name:                  "api",
				OOMKilled:             true,
				RestartCount:          6,
				LastStartedAt:         now,
				HealthFailStreak:      3,
				DesiredNetworks:       []string{"app_net"},
				AttachedNetworks:      []string{},
				AnonymousVolumeMounts: 1,
				CPUThrottleRatio:      0.25,
			},
		},
	}

	findings := engine.Analyze(snapshot)
	if len(findings) != 6 {
		t.Fatalf("expected 6 findings, got %d", len(findings))
	}

	wantCodes := map[string]struct{}{
		"OOM_KILLED":          {},
		"RESTART_LOOP":        {},
		"HEALTH_FAIL_STREAK":  {},
		"NETWORK_UNREACHABLE": {},
		"ANONYMOUS_VOLUME":    {},
		"CPU_THROTTLE_HIGH":   {},
	}

	gotCodes := make(map[string]struct{}, len(findings))
	for _, finding := range findings {
		gotCodes[finding.Code] = struct{}{}
	}

	for code := range wantCodes {
		if _, ok := gotCodes[code]; !ok {
			t.Fatalf("expected finding code %q to be present", code)
		}
	}
}
