package cgroup

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type MetricsSample struct {
	CPUUsageUsec     uint64
	MemoryUsageBytes uint64
	IOReadBytes      uint64
	IOWriteBytes     uint64
	ThrottledPeriods uint64
}

type Reader struct {
	root string
}

func NewReader(root string) *Reader {
	return &Reader{root: root}
}

func (r *Reader) Read(relativePath string) (MetricsSample, error) {
	base := filepath.Join(r.root, relativePath)

	cpuUsage, throttled, err := readCPUStat(filepath.Join(base, "cpu.stat"))
	if err != nil {
		return MetricsSample{}, err
	}

	memoryUsage, err := readSingleUint(filepath.Join(base, "memory.current"))
	if err != nil {
		return MetricsSample{}, err
	}

	readBytes, writeBytes, err := readIOStat(filepath.Join(base, "io.stat"))
	if err != nil {
		return MetricsSample{}, err
	}

	return MetricsSample{
		CPUUsageUsec:     cpuUsage,
		MemoryUsageBytes: memoryUsage,
		IOReadBytes:      readBytes,
		IOWriteBytes:     writeBytes,
		ThrottledPeriods: throttled,
	}, nil
}

func readSingleUint(path string) (uint64, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return 0, fmt.Errorf("read %s: %w", path, err)
	}
	v, err := strconv.ParseUint(strings.TrimSpace(string(b)), 10, 64)
	if err != nil {
		return 0, fmt.Errorf("parse %s: %w", path, err)
	}
	return v, nil
}

func readCPUStat(path string) (usageUsec uint64, throttled uint64, err error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, 0, fmt.Errorf("open %s: %w", path, err)
	}
	defer f.Close()

	s := bufio.NewScanner(f)
	for s.Scan() {
		parts := strings.Fields(s.Text())
		if len(parts) != 2 {
			continue
		}
		value, parseErr := strconv.ParseUint(parts[1], 10, 64)
		if parseErr != nil {
			return 0, 0, fmt.Errorf("parse %s value %q: %w", parts[0], parts[1], parseErr)
		}
		switch parts[0] {
		case "usage_usec":
			usageUsec = value
		case "nr_throttled":
			throttled = value
		}
	}
	if err := s.Err(); err != nil {
		return 0, 0, fmt.Errorf("scan %s: %w", path, err)
	}
	return usageUsec, throttled, nil
}

func readIOStat(path string) (readBytes uint64, writeBytes uint64, err error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, 0, fmt.Errorf("open %s: %w", path, err)
	}
	defer f.Close()

	s := bufio.NewScanner(f)
	for s.Scan() {
		parts := strings.Fields(s.Text())
		for _, token := range parts {
			if strings.HasPrefix(token, "rbytes=") {
				value := strings.TrimPrefix(token, "rbytes=")
				v, parseErr := strconv.ParseUint(value, 10, 64)
				if parseErr != nil {
					return 0, 0, fmt.Errorf("parse io rbytes %q: %w", value, parseErr)
				}
				readBytes += v
			}
			if strings.HasPrefix(token, "wbytes=") {
				value := strings.TrimPrefix(token, "wbytes=")
				v, parseErr := strconv.ParseUint(value, 10, 64)
				if parseErr != nil {
					return 0, 0, fmt.Errorf("parse io wbytes %q: %w", value, parseErr)
				}
				writeBytes += v
			}
		}
	}
	if err := s.Err(); err != nil {
		return 0, 0, fmt.Errorf("scan %s: %w", path, err)
	}
	return readBytes, writeBytes, nil
}
