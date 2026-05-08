package server

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"Rocker/internal/domain"
)

func writeAppError(w http.ResponseWriter, status int, appErr domain.AppError) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(appErr)
}

func ProjectCurrentHandler(snapshotProvider SnapshotProvider) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		snapshot := snapshotProvider()
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"projectName": snapshot.Meta.ProjectName,
			"composePath": snapshot.Meta.ComposePath,
		})
	})
}

func ServiceLogsHandler(runtime RuntimeActions) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if runtime == nil {
			writeAppError(w, http.StatusNotImplemented, domain.NewAppError(
				domain.ErrCodeDockerUnreachable,
				"runtime actions unavailable",
				true,
			))
			return
		}

		service := strings.TrimPrefix(r.URL.Path, "/api/v1/services/")
		service = strings.TrimSuffix(service, "/logs")
		tail := 200
		if q := r.URL.Query().Get("tail"); q != "" {
			if parsed, err := strconv.Atoi(q); err == nil && parsed > 0 {
				tail = parsed
			}
		}

		logs, err := runtime.Logs(strings.Trim(service, "/"), tail)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		defer logs.Close()

		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = io.Copy(w, logs)
	})
}

func RestartContainerHandler(runtime RuntimeActions) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if runtime == nil {
			writeAppError(w, http.StatusNotImplemented, domain.NewAppError(
				domain.ErrCodeDockerUnreachable,
				"runtime actions unavailable",
				true,
			))
			return
		}
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		id := strings.TrimPrefix(r.URL.Path, "/api/v1/containers/")
		id = strings.TrimSuffix(id, "/restart")
		id = strings.Trim(id, "/")
		if id == "" {
			http.Error(w, "container id required", http.StatusBadRequest)
			return
		}

		if err := runtime.Restart(id); err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}

		w.WriteHeader(http.StatusAccepted)
	})
}

func EventsHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		since := r.URL.Query().Get("since")
		if since != "" {
			if _, err := time.Parse(time.RFC3339, since); err != nil {
				writeAppError(w, http.StatusBadRequest, domain.NewAppError(
					domain.ErrCodeComposeInvalid,
					"invalid since timestamp",
					false,
				))
				return
			}
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"events": []any{}})
	})
}

func WSPlaceholderHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "websocket endpoint not wired yet", http.StatusNotImplemented)
	})
}
