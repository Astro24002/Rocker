package analyzer

import (
	"testing"

	"Rocker/internal/domain"
)

func TestAnonymousVolumeRuleFlagsAnonymousMounts(t *testing.T) {
	rule := &anonymousVolumeRule{}
	snapshot := domain.AppGraphSnapshot{
		Containers: []domain.Container{
			{Name: "api", AnonymousVolumeMounts: 1},
			{Name: "worker", AnonymousVolumeMounts: 0},
		},
	}

	findings := rule.Evaluate(snapshot)
	if len(findings) != 1 {
		t.Fatalf("expected 1 finding, got %d", len(findings))
	}
	if findings[0].Code != "ANONYMOUS_VOLUME" {
		t.Fatalf("expected code ANONYMOUS_VOLUME, got %q", findings[0].Code)
	}
	if findings[0].Message != "container api uses anonymous volume mounts" {
		t.Fatalf("unexpected finding message: %q", findings[0].Message)
	}
}
