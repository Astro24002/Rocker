package docker

import (
	"testing"

	"Rocker/internal/infra/cgroup"
)

func TestMapCgroupSampleIncludesCPUAndMemory(t *testing.T) {
	sample := cgroup.MetricsSample{
		CPUUsageUsec:     1500,
		MemoryUsageBytes: 4096,
		IOReadBytes:      10,
		IOWriteBytes:     20,
		ThrottledPeriods: 3,
	}

	metrics := MapCgroupSample(sample)

	if metrics.CPUUsageUsec != 1500 {
		t.Fatalf("expected cpu usage 1500, got %d", metrics.CPUUsageUsec)
	}
	if metrics.MemoryUsageBytes != 4096 {
		t.Fatalf("expected memory usage 4096, got %d", metrics.MemoryUsageBytes)
	}
}
