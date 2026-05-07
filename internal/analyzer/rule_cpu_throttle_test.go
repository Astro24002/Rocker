package analyzer

import (
	"testing"

	"Rocker/internal/domain"
)

func TestCPUThrottleRuleFlagsHighThrottleRatio(t *testing.T) {
	rule := &cpuThrottleRule{}
	snapshot := domain.AppGraphSnapshot{
		Containers: []domain.Container{
			{Name: "api", CPUThrottleRatio: 0.2},
			{Name: "worker", CPUThrottleRatio: 0.19},
		},
	}

	findings := rule.Evaluate(snapshot)
	if len(findings) != 1 {
		t.Fatalf("expected 1 finding, got %d", len(findings))
	}
	if findings[0].Code != "CPU_THROTTLE_HIGH" {
		t.Fatalf("expected code CPU_THROTTLE_HIGH, got %q", findings[0].Code)
	}
	if findings[0].Message != "container api CPU throttling ratio is >= 0.2" {
		t.Fatalf("unexpected finding message: %q", findings[0].Message)
	}
}

func TestCPUThrottleRuleBoundaryBehavior(t *testing.T) {
	rule := &cpuThrottleRule{}
	snapshot := domain.AppGraphSnapshot{
		Containers: []domain.Container{
			{Name: "threshold", CPUThrottleRatio: 0.2},
			{Name: "below", CPUThrottleRatio: 0.1999},
		},
	}

	findings := rule.Evaluate(snapshot)
	if len(findings) != 1 {
		t.Fatalf("expected 1 finding, got %d", len(findings))
	}
	if findings[0].Code != "CPU_THROTTLE_HIGH" {
		t.Fatalf("expected code CPU_THROTTLE_HIGH, got %q", findings[0].Code)
	}
	if findings[0].Message != "container threshold CPU throttling ratio is >= 0.2" {
		t.Fatalf("unexpected finding message: %q", findings[0].Message)
	}
}
