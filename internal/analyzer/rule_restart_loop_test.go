package analyzer

import (
	"testing"
	"time"

	"Rocker/internal/domain"
)

func TestRestartLoopRuleFlagsRestartBurst(t *testing.T) {
	now := time.Now().UTC()
	rule := &restartLoopRule{now: func() time.Time { return now }}
	snapshot := domain.AppGraphSnapshot{
		Containers: []domain.Container{
			{Name: "api", RestartCount: 5, LastStartedAt: now.Add(-2 * time.Minute)},
			{Name: "worker", RestartCount: 4, LastStartedAt: now.Add(-2 * time.Minute)},
		},
	}

	findings := rule.Evaluate(snapshot)
	if len(findings) != 1 {
		t.Fatalf("expected 1 finding, got %d", len(findings))
	}
	if findings[0].Code != "RESTART_LOOP" {
		t.Fatalf("expected code RESTART_LOOP, got %q", findings[0].Code)
	}
	if findings[0].Message != "container api restarted 5 times within 5 minutes" {
		t.Fatalf("unexpected finding message: %q", findings[0].Message)
	}
}
