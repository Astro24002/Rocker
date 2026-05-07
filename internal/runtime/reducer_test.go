package runtime

import (
	"testing"

	"Rocker/internal/domain"
)

func TestReducerUpdatesContainerStateOnStartStop(t *testing.T) {
	store := NewStore()
	store.ReplaceContainers([]domain.Container{{ID: "c1", Name: "api", State: "created"}})

	ApplyEvent(store, Event{Type: "container", ID: "c1", Action: "start"})
	state := store.State()
	if got := state.Containers["c1"].State; got != "running" {
		t.Fatalf("expected running after start, got %q", got)
	}

	ApplyEvent(store, Event{Type: "container", ID: "c1", Action: "stop"})
	state = store.State()
	if got := state.Containers["c1"].State; got != "exited" {
		t.Fatalf("expected exited after stop, got %q", got)
	}
}

func TestReducerDoesNotIncrementVersionWhenStateUnchanged(t *testing.T) {
	store := NewStore()
	store.ReplaceContainers([]domain.Container{{ID: "c1", Name: "api", State: "running"}})

	before := store.State().Version
	ApplyEvent(store, Event{Type: "container", ID: "c1", Action: "start"})
	after := store.State().Version

	if after != before {
		t.Fatalf("expected version to stay %d when state unchanged, got %d", before, after)
	}
}
