package docker

import (
	"context"
	"io"
	"io/ioutil"
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

func TestClientStreamEvents_ClosedChannel(t *testing.T) {
	client := NewClient()

	ch, err := client.StreamEvents(context.Background())
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	_, ok := <-ch
	if ok {
		t.Fatalf("expected events channel to be closed")
	}
}

func TestClientContainerLogs_EmptyReadableCloser(t *testing.T) {
	client := NewClient()

	r, err := client.ContainerLogs(context.Background(), "abc", 10)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	defer r.Close()

	data, err := ioutil.ReadAll(r)
	if err != nil {
		t.Fatalf("expected readable closer, got read error: %v", err)
	}

	if string(data) != "" {
		t.Fatalf("expected empty logs, got %q", string(data))
	}
}

func TestClientListMethods_ReturnEmptySlices(t *testing.T) {
	client := NewClient()

	containers, err := client.ListContainers(context.Background())
	if err != nil {
		t.Fatalf("expected no error from ListContainers, got %v", err)
	}
	if containers == nil || len(containers) != 0 {
		t.Fatalf("expected empty non-nil containers slice, got %#v", containers)
	}

	networks, err := client.ListNetworks(context.Background())
	if err != nil {
		t.Fatalf("expected no error from ListNetworks, got %v", err)
	}
	if networks == nil || len(networks) != 0 {
		t.Fatalf("expected empty non-nil networks slice, got %#v", networks)
	}

	volumes, err := client.ListVolumes(context.Background())
	if err != nil {
		t.Fatalf("expected no error from ListVolumes, got %v", err)
	}
	if volumes == nil || len(volumes) != 0 {
		t.Fatalf("expected empty non-nil volumes slice, got %#v", volumes)
	}
}
