package compose

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadComposeParsesServices(t *testing.T) {
	tempDir := t.TempDir()
	composePath := filepath.Join(tempDir, "compose.yml")

	content := []byte(`services:
  web:
    image: nginx:alpine
    depends_on:
      - redis
    ports:
      - "8080:80"
    networks:
      - appnet
    volumes:
      - webdata:/data
  redis:
    image: redis:7
    networks:
      - appnet

networks:
  appnet: {}

volumes:
  webdata: {}
`)

	if err := os.WriteFile(composePath, content, 0o644); err != nil {
		t.Fatalf("failed to write compose file: %v", err)
	}

	loader := NewLoader()
	model, err := loader.Load(composePath)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if len(model.Services) != 2 {
		t.Fatalf("expected 2 services, got %d", len(model.Services))
	}

	web, ok := model.Services["web"]
	if !ok {
		t.Fatalf("expected web service to be present")
	}

	if len(web.DependsOn) != 1 || web.DependsOn[0] != "redis" {
		t.Fatalf("expected web depends_on [redis], got %#v", web.DependsOn)
	}
}
