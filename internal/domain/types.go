package domain

import "time"

type ComposeModel struct {
	Services map[string]ComposeService
}

type ComposeService struct {
	DependsOn []string
	Networks  []string
	Volumes   []string
	Ports     []string
}

type Service struct{}

type Container struct {
	ID                    string
	Name                  string
	Image                 string
	State                 string
	Status                string
	OOMKilled             bool
	RestartCount          int
	LastStartedAt         time.Time
	HealthFailStreak      int
	DesiredNetworks       []string
	AttachedNetworks      []string
	AnonymousVolumeMounts int
	CPUThrottleRatio      float64
}

type Network struct {
	ID     string
	Name   string
	Driver string
	Scope  string
}

type Volume struct {
	Name   string
	Driver string
}

type Explanation struct {
	Code    string
	Summary string
}
