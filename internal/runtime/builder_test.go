package runtime

import (
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
