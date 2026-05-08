package cgroup

import (
	"os"
	"path/filepath"
	"testing"
)

func TestMetricsSampleIncludesCPUAndMemory(t *testing.T) {
	root := t.TempDir()
	cgroupDir := filepath.Join(root, "cgroup")
	if err := os.MkdirAll(cgroupDir, 0o755); err != nil {
		t.Fatalf("mkdir cgroup dir: %v", err)
	}

	write := func(name, content string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(cgroupDir, name), []byte(content), 0o644); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}

	write("cpu.stat", "usage_usec 1234\nnr_throttled 7\n")
	write("memory.current", "2048\n")
	write("io.stat", "8:0 rbytes=11 wbytes=22\n")

	reader := NewReader(root)
	sample, err := reader.Read("cgroup")
	if err != nil {
		t.Fatalf("read metrics: %v", err)
	}

	if sample.CPUUsageUsec != 1234 {
		t.Fatalf("expected CPU usage 1234, got %d", sample.CPUUsageUsec)
	}
	if sample.MemoryUsageBytes != 2048 {
		t.Fatalf("expected memory usage 2048, got %d", sample.MemoryUsageBytes)
	}
}
