package compose

import (
	"os"
	"strings"

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
		volumes := make([]string, 0, len(service.Volumes))
		for _, volume := range service.Volumes {
			parts := strings.SplitN(volume, ":", 2)
			volumes = append(volumes, parts[0])
		}

		model.Services[name] = domain.ComposeService{
			DependsOn: append([]string(nil), service.DependsOn...),
			Networks:  append([]string(nil), service.Networks...),
			Volumes:   volumes,
			Ports:     append([]string(nil), service.Ports...),
		}
	}

	return model, nil
}
