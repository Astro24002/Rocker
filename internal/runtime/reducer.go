package runtime

import "Rocker/internal/domain"

func ApplyEvent(store *Store, event Event) {
	store.Commit(func(state *RuntimeState) bool {
		if event.Type != "container" {
			return false
		}

		container, ok := state.Containers[event.ID]
		if !ok {
			container = domain.Container{ID: event.ID}
		}

		switch event.Action {
		case "start":
			container.State = "running"
		case "stop":
			container.State = "exited"
		default:
			return false
		}

		state.Containers[event.ID] = container
		return true
	})
}
