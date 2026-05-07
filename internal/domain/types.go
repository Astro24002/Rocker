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

type Container struct{}

type Network struct{}

type Volume struct{}

type Explanation struct {
	Code    string
	Summary string
}
