package runtime

import "Rocker/internal/domain"

func ReconcileContainers(store *Store, containers []domain.Container) {
	store.Commit(func(state *RuntimeState) bool {
		next := make(map[string]domain.Container, len(containers))
		for _, container := range containers {
			next[container.ID] = container
		}

		changed := len(next) != len(state.Containers)
		if !changed {
			for id, container := range next {
				if current, ok := state.Containers[id]; !ok || current != container {
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
