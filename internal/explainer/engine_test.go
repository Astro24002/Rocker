package explainer

import (
	"testing"

	"Rocker/internal/domain"
)

func TestExplainerBuildsReasonImpactActions(t *testing.T) {
	engine := NewEngine()

	findings := []domain.Finding{
		{Code: "OOM_KILLED", Message: "container api was OOM-killed"},
	}

	explanations := engine.Build(findings)
	if len(explanations) != 1 {
		t.Fatalf("expected 1 explanation, got %d", len(explanations))
	}

	explanation := explanations[0]
	if explanation.Reason == "" {
		t.Fatal("expected reason to be set")
	}
	if explanation.Impact == "" {
		t.Fatal("expected impact to be set")
	}
	if len(explanation.Actions) < 1 {
		t.Fatal("expected at least one action")
	}
	if len(explanation.EvidenceRefs) < 1 {
		t.Fatal("expected at least one evidence ref")
	}
}
