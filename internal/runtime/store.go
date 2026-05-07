package runtime

import "Rocker/internal/domain"

type RuntimeState struct {
	Version    uint64
	Containers map[string]domain.Container
}

type Store struct {
	state RuntimeState
}

func NewStore() *Store {
	return &Store{
		state: RuntimeState{
			Containers: make(map[string]domain.Container),
		},
	}
}

func (s *Store) State() RuntimeState {
	containers := make(map[string]domain.Container, len(s.state.Containers))
	for id, container := range s.state.Containers {
		containers[id] = container
	}

	return RuntimeState{
		Version:    s.state.Version,
		Containers: containers,
	}
}

func (s *Store) Commit(mutator func(state *RuntimeState) bool) bool {
	next := s.State()
	if !mutator(&next) {
		return false
	}

	next.Version++
	s.state = next
	return true
}

func (s *Store) ReplaceContainers(containers []domain.Container) {
	s.Commit(func(state *RuntimeState) bool {
		state.Containers = make(map[string]domain.Container, len(containers))
		for _, container := range containers {
			state.Containers[container.ID] = container
		}
		return true
	})
}
