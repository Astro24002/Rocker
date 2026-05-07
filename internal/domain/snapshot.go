package domain

import "time"

const snapshotSchemaVersion uint64 = 1

type SnapshotMeta struct {
	ProjectName string
	ComposePath string
	Version     uint64
	GeneratedAt time.Time
}

type AppGraphSnapshot struct {
	Meta         SnapshotMeta
	Services     []Service
	Containers   []Container
	Networks     []Network
	Volumes      []Volume
	Findings     []Finding
	Explanations []Explanation
}

func NewAppGraphSnapshot() AppGraphSnapshot {
	return AppGraphSnapshot{
		Meta: SnapshotMeta{
			Version:     snapshotSchemaVersion,
			GeneratedAt: time.Now().UTC(),
		},
	}
}
