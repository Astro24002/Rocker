package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"Rocker/internal/domain"
)

func TestSnapshotHandlerReturnsJSON(t *testing.T) {
	snapshot := domain.AppGraphSnapshot{
		Meta: domain.SnapshotMeta{
			ProjectName: "demo",
			ComposePath: "compose.yml",
			Version:     1,
			GeneratedAt: time.Now().UTC(),
		},
	}

	handler := SnapshotHandler(func() domain.AppGraphSnapshot { return snapshot })
	req := httptest.NewRequest(http.MethodGet, "/api/v1/snapshot", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rr.Code)
	}

	if got := rr.Header().Get("Content-Type"); !strings.Contains(got, "application/json") {
		t.Fatalf("expected application/json content type, got %q", got)
	}

	var decoded domain.AppGraphSnapshot
	if err := json.Unmarshal(rr.Body.Bytes(), &decoded); err != nil {
		t.Fatalf("expected valid JSON response, got unmarshal err: %v", err)
	}

	if decoded.Meta.Version != 1 {
		t.Fatalf("expected snapshot version 1, got %d", decoded.Meta.Version)
	}
}

func TestWSHubBroadcastsSnapshotInit(t *testing.T) {
	hub := NewWSHub()
	client := hub.Subscribe()

	snapshot := domain.NewAppGraphSnapshot()
	hub.BroadcastSnapshotInit(snapshot)

	select {
	case msg := <-client:
		if msg.Kind != "snapshot.init" {
			t.Fatalf("expected kind snapshot.init, got %q", msg.Kind)
		}
		if msg.Snapshot.Meta.Version != snapshot.Meta.Version {
			t.Fatalf("expected snapshot version %d, got %d", snapshot.Meta.Version, msg.Snapshot.Meta.Version)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("expected snapshot.init message to be broadcast")
	}
}
