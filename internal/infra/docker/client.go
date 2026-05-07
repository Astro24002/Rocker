package docker

import (
	"context"
	"io"
	"strings"

	"Rocker/internal/domain"
	"Rocker/internal/runtime"
)

type Client struct{}

func NewClient() *Client { return &Client{} }

func (c *Client) ListContainers(ctx context.Context) ([]domain.Container, error) {
	return nil, nil
}

func (c *Client) ListNetworks(ctx context.Context) ([]domain.Network, error) {
	return nil, nil
}

func (c *Client) ListVolumes(ctx context.Context) ([]domain.Volume, error) {
	return nil, nil
}

func (c *Client) StreamEvents(ctx context.Context) (<-chan runtime.Event, error) {
	ch := make(chan runtime.Event)
	close(ch)
	return ch, nil
}

func (c *Client) ContainerLogs(ctx context.Context, id string, tail int) (io.ReadCloser, error) {
	return io.NopCloser(strings.NewReader("")), nil
}

func (c *Client) RestartContainer(ctx context.Context, id string) error {
	return nil
}
