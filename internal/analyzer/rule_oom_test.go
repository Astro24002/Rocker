package analyzer

import (
	"testing"

	"Rocker/internal/domain"
)

func TestOOMRuleFlagsOOMKilledContainers(t *testing.T) {
	rule := &oomRule{}
	snapshot := domain.AppGraphSnapshot{
		Containers: []domain.Container{
			{Name: "api", OOMKilled: true},
			{Name: "worker", OOMKilled: false},
		},
	}

	findings := rule.Evaluate(snapshot)
	if len(findings) != 1 {
		t.Fatalf("expected 1 finding, got %d", len(findings))
	}
	if findings[0].Code != "OOM_KILLED" {
		t.Fatalf("expected code OOM_KILLED, got %q", findings[0].Code)
	}
	if findings[0].Message != "container api was OOM-killed" {
		t.Fatalf("unexpected finding message: %q", findings[0].Message)
	}
}
