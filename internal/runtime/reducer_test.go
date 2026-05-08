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

func TestReconcileContainersDoesNotIncrementVersionWhenUnchanged(t *testing.T) {
	store := NewStore()
	containers := []domain.Container{{ID: "c1", Name: "api", State: "running"}}
	store.ReplaceContainers(containers)

	before := store.State().Version
	ReconcileContainers(store, containers)
	after := store.State().Version

	if after != before {
		t.Fatalf("expected version to stay %d for unchanged reconcile, got %d", before, after)
	}
}

func TestReconcileContainersDoesNotIncrementVersionWhenSlicesMatch(t *testing.T) {
	store := NewStore()
	containers := []domain.Container{{
		ID:               "c1",
		Name:             "api",
		State:            "running",
		DesiredNetworks:  []string{"backend", "frontend"},
		AttachedNetworks: []string{"backend", "frontend"},
	}}
	store.ReplaceContainers(containers)

	before := store.State().Version
	ReconcileContainers(store, containers)
	after := store.State().Version

	if after != before {
		t.Fatalf("expected version to stay %d for unchanged reconcile with slices, got %d", before, after)
	}
}

func TestReconcileContainersIncrementsVersionAndReplacesStateWhenChanged(t *testing.T) {
	store := NewStore()
	store.ReplaceContainers([]domain.Container{
		{ID: "stale", Name: "old", State: "exited"},
	})

	before := store.State().Version
	ReconcileContainers(store, []domain.Container{
		{ID: "fresh", Name: "api", State: "running"},
	})
	afterState := store.State()

	if afterState.Version != before+1 {
		t.Fatalf("expected version to increment from %d to %d, got %d", before, before+1, afterState.Version)
	}

	if _, ok := afterState.Containers["stale"]; ok {
		t.Fatalf("expected stale container to be removed")
	}

	if got := afterState.Containers["fresh"].State; got != "running" {
		t.Fatalf("expected fresh container state to be running, got %q", got)
	}
}

func TestReducerUnknownEventIsNoOpForVersion(t *testing.T) {
	store := NewStore()
	store.ReplaceContainers([]domain.Container{{ID: "c1", Name: "api", State: "running"}})

	before := store.State().Version
	ApplyEvent(store, Event{Type: "container", ID: "c1", Action: "bogus"})
	after := store.State().Version

	if after != before {
		t.Fatalf("expected version to stay %d for unknown event action, got %d", before, after)
	}
}
