package runtime

import (
	"sort"

	"Rocker/internal/domain"
)

func BuildSnapshot(composeModel domain.ComposeModel, state RuntimeState, projectName string, composePath string) domain.AppGraphSnapshot {
	services := make([]domain.Service, 0, len(composeModel.Services))
	if len(composeModel.Services) > 0 {
		names := make([]string, 0, len(composeModel.Services))
		for name := range composeModel.Services {
			names = append(names, name)
		}
		sort.Strings(names)
		for range names {
			services = append(services, domain.Service{})
		}
	}

	containers := make([]domain.Container, 0, len(state.Containers))
	for _, container := range state.Containers {
		containers = append(containers, container)
	}

	snapshot := domain.AppGraphSnapshot{
		Meta:       domain.NewSnapshotMeta(projectName, composePath),
		Services:   services,
		Containers: containers,
	}

	return snapshot
}
