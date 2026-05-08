package runtime

import (
	"strings"
	"testing"

	"Rocker/internal/domain"
)

func TestSnapshotHasVersionAndTimestamp(t *testing.T) {
	snapshot := domain.NewAppGraphSnapshot()

	if snapshot.Meta.Version == 0 {
		t.Fatalf("expected Meta.Version to be non-zero")
	}

	if snapshot.Meta.GeneratedAt.IsZero() {
		t.Fatalf("expected Meta.GeneratedAt to be set")
	}
}

func TestNewSnapshotMetaAssignsProjectAndComposePath(t *testing.T) {
	meta := domain.NewSnapshotMeta("rocker", "compose.yml")

	if meta.ProjectName != "rocker" {
		t.Fatalf("expected ProjectName to be rocker, got %q", meta.ProjectName)
	}

	if meta.ComposePath != "compose.yml" {
		t.Fatalf("expected ComposePath to be compose.yml, got %q", meta.ComposePath)
	}

	if meta.Version == 0 {
		t.Fatalf("expected Version to be non-zero")
	}

	if meta.GeneratedAt.IsZero() {
		t.Fatalf("expected GeneratedAt to be set")
	}
}

func TestBuildSnapshotContainersAreDeterministicAcrossMapInsertionOrders(t *testing.T) {
	stateA := RuntimeState{
		Containers: map[string]domain.Container{
			"c": {ID: "c", Name: "c"},
			"a": {ID: "a", Name: "a"},
			"b": {ID: "b", Name: "b"},
		},
	}

	stateB := RuntimeState{Containers: make(map[string]domain.Container)}
	stateB.Containers["a"] = domain.Container{ID: "a", Name: "a"}
	stateB.Containers["b"] = domain.Container{ID: "b", Name: "b"}
	stateB.Containers["c"] = domain.Container{ID: "c", Name: "c"}

	compose := domain.ComposeModel{}
	orderA := ""
	orderB := ""

	for i := 0; i < 20; i++ {
		snapshotA := BuildSnapshot(compose, stateA, "rocker", "compose.yml")
		snapshotB := BuildSnapshot(compose, stateB, "rocker", "compose.yml")

		currentA := containerIDs(snapshotA.Containers)
		currentB := containerIDs(snapshotB.Containers)

		if i == 0 {
			orderA = currentA
			orderB = currentB
			continue
		}

		if currentA != orderA {
			t.Fatalf("expected deterministic ordering for stateA, got %q then %q", orderA, currentA)
		}

		if currentB != orderB {
			t.Fatalf("expected deterministic ordering for stateB, got %q then %q", orderB, currentB)
		}
	}

	if orderA != orderB {
		t.Fatalf("expected identical ordering across insertion orders, got %q and %q", orderA, orderB)
	}
}

func containerIDs(containers []domain.Container) string {
	ids := make([]string, 0, len(containers))
	for _, container := range containers {
		ids = append(ids, container.ID)
	}
	return strings.Join(ids, ",")
}
