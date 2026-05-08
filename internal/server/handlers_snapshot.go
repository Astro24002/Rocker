package server

import (
	"encoding/json"
	"net/http"

	"Rocker/internal/domain"
)

type SnapshotProvider func() domain.AppGraphSnapshot

func SnapshotHandler(provider SnapshotProvider) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		snapshot := provider()
		_ = json.NewEncoder(w).Encode(snapshot)
	})
}
