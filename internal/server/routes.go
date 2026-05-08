package server

import (
	"io"
	"net/http"

	"Rocker/internal/domain"
)

type RuntimeActions interface {
	Logs(service string, tail int) (io.ReadCloser, error)
	Restart(containerID string) error
}

func RegisterRoutes(mux *http.ServeMux, snapshotProvider SnapshotProvider, runtime RuntimeActions) {
	mux.Handle("/api/v1/projects/current", ProjectCurrentHandler(snapshotProvider))
	mux.Handle("/api/v1/snapshot", SnapshotHandler(snapshotProvider))
	mux.Handle("/api/v1/services/", ServiceLogsHandler(runtime))
	mux.Handle("/api/v1/containers/", RestartContainerHandler(runtime))
	mux.Handle("/api/v1/events", EventsHandler())
	mux.Handle("/api/v1/ws", WSPlaceholderHandler())
	mux.Handle("/", http.FileServer(http.Dir(".")))
}

func defaultSnapshotProvider() domain.AppGraphSnapshot {
	return domain.NewAppGraphSnapshot()
}
