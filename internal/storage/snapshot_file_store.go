package storage

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"Rocker/internal/domain"
)

type SnapshotFileStore struct {
	latestPath string
}

func NewSnapshotFileStore(root string) *SnapshotFileStore {
	return &SnapshotFileStore{
		latestPath: filepath.Join(root, ".rocker", "snapshots", "latest.json"),
	}
}

func (s *SnapshotFileStore) SaveLatest(snapshot domain.AppGraphSnapshot) error {
	dir := filepath.Dir(s.latestPath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create snapshot directory %q: %w", dir, err)
	}

	data, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal snapshot: %w", err)
	}

	if err := os.WriteFile(s.latestPath, data, 0o644); err != nil {
		return fmt.Errorf("write latest snapshot %q: %w", s.latestPath, err)
	}

	return nil
}

func (s *SnapshotFileStore) LoadLatest() (domain.AppGraphSnapshot, error) {
	data, err := os.ReadFile(s.latestPath)
	if err != nil {
		return domain.AppGraphSnapshot{}, fmt.Errorf("read latest snapshot %q: %w", s.latestPath, err)
	}

	var snapshot domain.AppGraphSnapshot
	if err := json.Unmarshal(data, &snapshot); err != nil {
		return domain.AppGraphSnapshot{}, fmt.Errorf("unmarshal latest snapshot %q: %w", s.latestPath, err)
	}

	return snapshot, nil
}
