package docker

import "Rocker/internal/infra/cgroup"

type ContainerMetrics struct {
	CPUUsageUsec     uint64
	MemoryUsageBytes uint64
	IOReadBytes      uint64
	IOWriteBytes     uint64
	ThrottledPeriods uint64
}

func MapCgroupSample(sample cgroup.MetricsSample) ContainerMetrics {
	return ContainerMetrics{
		CPUUsageUsec:     sample.CPUUsageUsec,
		MemoryUsageBytes: sample.MemoryUsageBytes,
		IOReadBytes:      sample.IOReadBytes,
		IOWriteBytes:     sample.IOWriteBytes,
		ThrottledPeriods: sample.ThrottledPeriods,
	}
}
