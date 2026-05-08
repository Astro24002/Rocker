package runtime

import (
	"sort"

	"Rocker/internal/domain"
)

func BuildSnapshot(composeModel domain.ComposeModel, state RuntimeState, projectName string, composePath string) domain.AppGraphSnapshot {
	services := make([]domain.Service, len(composeModel.Services))

	containerIDs := make([]string, 0, len(state.Containers))
	for id := range state.Containers {
		containerIDs = append(containerIDs, id)
	}
	sort.Strings(containerIDs)

	containers := make([]domain.Container, 0, len(containerIDs))
	for _, id := range containerIDs {
		containers = append(containers, state.Containers[id])
	}

	snapshot := domain.AppGraphSnapshot{
		Meta:       domain.NewSnapshotMeta(projectName, composePath),
		Services:   services,
		Containers: containers,
	}

	return snapshot
}
