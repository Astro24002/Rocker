package runtime

import (
	"context"
	"io"
	"time"

	"Rocker/internal/domain"
)

type Event struct {
	Type   string
	ID     string
	Action string
	Time   time.Time
}

type RuntimeSource interface {
	ListContainers(ctx context.Context) ([]domain.Container, error)
	ListNetworks(ctx context.Context) ([]domain.Network, error)
	ListVolumes(ctx context.Context) ([]domain.Volume, error)
	StreamEvents(ctx context.Context) (<-chan Event, error)
	ContainerLogs(ctx context.Context, id string, tail string) (io.ReadCloser, error)
	RestartContainer(ctx context.Context, id string) error
}
