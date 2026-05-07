package compose

import (
	"os"

	"Rocker/internal/domain"
	"gopkg.in/yaml.v3"
)

type ComposeLoader interface {
	Load(path string) (domain.ComposeModel, error)
}

type Loader struct{}

func NewLoader() ComposeLoader {
	return Loader{}
}

type composeYAML struct {
	Services map[string]serviceYAML `yaml:"services"`
}

type serviceYAML struct {
	DependsOn []string `yaml:"depends_on"`
	Networks  []string `yaml:"networks"`
	Volumes   []string `yaml:"volumes"`
	Ports     []string `yaml:"ports"`
}

func (Loader) Load(path string) (domain.ComposeModel, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return domain.ComposeModel{}, err
	}

	var parsed composeYAML
	if err := yaml.Unmarshal(data, &parsed); err != nil {
		return domain.ComposeModel{}, err
	}

	model := domain.ComposeModel{Services: make(map[string]domain.ComposeService, len(parsed.Services))}
	for name, service := range parsed.Services {
		model.Services[name] = domain.ComposeService{
			DependsOn: append([]string(nil), service.DependsOn...),
			Networks:  append([]string(nil), service.Networks...),
			Volumes:   append([]string(nil), service.Volumes...),
			Ports:     append([]string(nil), service.Ports...),
		}
	}

	return model, nil
}
