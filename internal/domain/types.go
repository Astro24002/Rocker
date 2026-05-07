package domain

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
	ID     string
	Name   string
	Image  string
	State  string
	Status string
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
