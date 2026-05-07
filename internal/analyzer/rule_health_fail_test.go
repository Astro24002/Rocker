package analyzer

import (
	"testing"

	"Rocker/internal/domain"
)

func TestHealthFailRuleFlagsFailStreak(t *testing.T) {
	rule := &healthFailRule{}
	snapshot := domain.AppGraphSnapshot{
		Containers: []domain.Container{
			{Name: "api", HealthFailStreak: 3},
			{Name: "worker", HealthFailStreak: 2},
		},
	}

	findings := rule.Evaluate(snapshot)
	if len(findings) != 1 {
		t.Fatalf("expected 1 finding, got %d", len(findings))
	}
	if findings[0].Code != "HEALTH_FAIL_STREAK" {
		t.Fatalf("expected code HEALTH_FAIL_STREAK, got %q", findings[0].Code)
	}
}
