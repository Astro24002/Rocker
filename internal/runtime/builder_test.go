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
