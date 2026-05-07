package docker

import (
	"context"
	"io"
	"testing"

	"Rocker/internal/runtime"
)

type logsContract interface {
	ContainerLogs(context.Context, string, int) (io.ReadCloser, error)
}

var _ runtime.RuntimeSource = (*Client)(nil)

func TestClientMatchesLogsContract(t *testing.T) {
	var _ logsContract = (*Client)(nil)
}
