package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"Rocker/internal/domain"
)

func TestAPIErrorBodyIncludesCodeAndRetryable(t *testing.T) {
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/services/api/logs", nil)

	h := ServiceLogsHandler(nil)
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotImplemented {
		t.Fatalf("expected 501 status, got %d", rr.Code)
	}

	var got domain.AppError
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("expected json error body, got unmarshal err: %v", err)
	}

	if got.Code != domain.ErrCodeDockerUnreachable {
		t.Fatalf("expected code %q, got %q", domain.ErrCodeDockerUnreachable, got.Code)
	}
	if !got.Retryable {
		t.Fatalf("expected retryable true")
	}
}
