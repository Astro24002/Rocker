package server

import (
	"net/http"
	"time"
)

func NewHTTPServer(addr string, snapshotProvider SnapshotProvider, runtime RuntimeActions) *http.Server {
	mux := http.NewServeMux()
	RegisterRoutes(mux, snapshotProvider, runtime)

	return &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
}
