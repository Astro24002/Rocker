package storage

import (
	"path/filepath"
	"testing"

	"Rocker/internal/domain"
)

func TestSnapshotFileStoreRoundTripLatest(t *testing.T) {
	root := t.TempDir()
	store := NewSnapshotFileStore(root)

	want := domain.AppGraphSnapshot{
		Meta: domain.SnapshotMeta{
			ProjectName: "rocker",
			ComposePath: "compose.yml",
			Version:     1,
		},
		Containers: []domain.Container{{ID: "c1", Name: "web", State: "running"}},
		Networks:   []domain.Network{{ID: "n1", Name: "default", Driver: "bridge"}},
		Volumes:    []domain.Volume{{Name: "data", Driver: "local"}},
	}

	if err := store.SaveLatest(want); err != nil {
		t.Fatalf("SaveLatest returned error: %v", err)
	}

	got, err := store.LoadLatest()
	if err != nil {
		t.Fatalf("LoadLatest returned error: %v", err)
	}

	if got.Meta.ProjectName != want.Meta.ProjectName {
		t.Fatalf("project name mismatch: got %q want %q", got.Meta.ProjectName, want.Meta.ProjectName)
	}

	if got.Meta.ComposePath != want.Meta.ComposePath {
		t.Fatalf("compose path mismatch: got %q want %q", got.Meta.ComposePath, want.Meta.ComposePath)
	}

	if got.Meta.Version != want.Meta.Version {
		t.Fatalf("version mismatch: got %d want %d", got.Meta.Version, want.Meta.Version)
	}

	if len(got.Containers) != 1 || got.Containers[0].ID != "c1" {
		t.Fatalf("containers mismatch: got %+v", got.Containers)
	}

	if len(got.Networks) != 1 || got.Networks[0].Name != "default" {
		t.Fatalf("networks mismatch: got %+v", got.Networks)
	}

	if len(got.Volumes) != 1 || got.Volumes[0].Name != "data" {
		t.Fatalf("volumes mismatch: got %+v", got.Volumes)
	}

	wantPath := filepath.Join(root, ".rocker", "snapshots", "latest.json")
	if store.latestPath != wantPath {
		t.Fatalf("latest path mismatch: got %q want %q", store.latestPath, wantPath)
	}
}

func TestSnapshotFileStoreSaveLatestIncrementsVersionAcrossSaves(t *testing.T) {
	root := t.TempDir()
	store := NewSnapshotFileStore(root)

	snapshot := domain.AppGraphSnapshot{
		Meta: domain.SnapshotMeta{
			ProjectName: "rocker",
			ComposePath: "compose.yml",
			Version:     1,
		},
	}

	if err := store.SaveLatest(snapshot); err != nil {
		t.Fatalf("first SaveLatest returned error: %v", err)
	}

	if err := store.SaveLatest(snapshot); err != nil {
		t.Fatalf("second SaveLatest returned error: %v", err)
	}

	got, err := store.LoadLatest()
	if err != nil {
		t.Fatalf("LoadLatest returned error: %v", err)
	}

	if got.Meta.Version != 2 {
		t.Fatalf("expected latest snapshot version 2 after sequential saves, got %d", got.Meta.Version)
	}
}
