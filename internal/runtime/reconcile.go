package runtime

import "Rocker/internal/domain"

func containersEqual(a, b domain.Container) bool {
	if a.ID != b.ID ||
		a.Name != b.Name ||
		a.Image != b.Image ||
		a.State != b.State ||
		a.Status != b.Status ||
		a.OOMKilled != b.OOMKilled ||
		a.RestartCount != b.RestartCount ||
		!a.LastStartedAt.Equal(b.LastStartedAt) ||
		a.HealthFailStreak != b.HealthFailStreak ||
		a.AnonymousVolumeMounts != b.AnonymousVolumeMounts ||
		a.CPUThrottleRatio != b.CPUThrottleRatio {
		return false
	}

	if len(a.DesiredNetworks) != len(b.DesiredNetworks) || len(a.AttachedNetworks) != len(b.AttachedNetworks) {
		return false
	}

	for i := range a.DesiredNetworks {
		if a.DesiredNetworks[i] != b.DesiredNetworks[i] {
			return false
		}
	}

	for i := range a.AttachedNetworks {
		if a.AttachedNetworks[i] != b.AttachedNetworks[i] {
			return false
		}
	}

	return true
}

func ReconcileContainers(store *Store, containers []domain.Container) {
	store.Commit(func(state *RuntimeState) bool {
		next := make(map[string]domain.Container, len(containers))
		for _, container := range containers {
			next[container.ID] = container
		}

		changed := len(next) != len(state.Containers)
		if !changed {
			for id, container := range next {
				if current, ok := state.Containers[id]; !ok || !containersEqual(current, container) {
					changed = true
					break
				}
			}
		}

		if !changed {
			return false
		}

		state.Containers = next
		return true
	})
}
