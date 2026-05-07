package analyzer

import (
	"testing"

	"Rocker/internal/domain"
)

func TestNetworkUnreachableRuleFlagsDisconnectedContainer(t *testing.T) {
	rule := &networkUnreachableRule{}
	snapshot := domain.AppGraphSnapshot{
		Containers: []domain.Container{
			{Name: "api", DesiredNetworks: []string{"app_net"}, AttachedNetworks: []string{}},
			{Name: "worker", DesiredNetworks: []string{"app_net"}, AttachedNetworks: []string{"app_net"}},
		},
	}

	findings := rule.Evaluate(snapshot)
	if len(findings) != 1 {
		t.Fatalf("expected 1 finding, got %d", len(findings))
	}
	if findings[0].Code != "NETWORK_UNREACHABLE" {
		t.Fatalf("expected code NETWORK_UNREACHABLE, got %q", findings[0].Code)
	}
}
