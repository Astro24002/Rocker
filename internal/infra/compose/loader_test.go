package compose

import (
	"strings"
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

	if len(web.Networks) != 1 || web.Networks[0] != "appnet" {
		t.Fatalf("expected web networks [appnet], got %#v", web.Networks)
	}

	if len(web.Volumes) != 1 || web.Volumes[0] != "webdata" {
		t.Fatalf("expected web volumes [webdata], got %#v", web.Volumes)
	}

	if len(web.Ports) != 1 || web.Ports[0] != "8080:80" {
		t.Fatalf("expected web ports [8080:80], got %#v", web.Ports)
	}
}

func TestLoadComposeMissingFileReturnsError(t *testing.T) {
	loader := NewLoader()
	missingPath := filepath.Join(t.TempDir(), "missing-compose.yml")

	_, err := loader.Load(missingPath)
	if err == nil {
		t.Fatalf("expected error for missing file")
	}

	want := "read compose file \"" + missingPath + "\""
	if !strings.Contains(err.Error(), want) {
		t.Fatalf("expected error to contain %q, got %q", want, err.Error())
	}
}

func TestLoadComposeInvalidYAMLReturnsError(t *testing.T) {
	composePath := filepath.Join(t.TempDir(), "compose.yml")
	invalid := []byte("services: [")
	if err := os.WriteFile(composePath, invalid, 0o644); err != nil {
		t.Fatalf("failed to write invalid compose file: %v", err)
	}

	loader := NewLoader()
	_, err := loader.Load(composePath)
	if err == nil {
		t.Fatalf("expected parse error for invalid yaml")
	}

	want := "parse compose file \"" + composePath + "\""
	if !strings.Contains(err.Error(), want) {
		t.Fatalf("expected error to contain %q, got %q", want, err.Error())
	}
}

func TestLoadComposeExtractsVolumeSourceFromBindLikeEntry(t *testing.T) {
	composePath := filepath.Join(t.TempDir(), "compose.yml")
	content := []byte(`services:
  web:
    volumes:
      - ./data:/var/lib/app:ro
`)

	if err := os.WriteFile(composePath, content, 0o644); err != nil {
		t.Fatalf("failed to write compose file: %v", err)
	}

	loader := NewLoader()
	model, err := loader.Load(composePath)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	web, ok := model.Services["web"]
	if !ok {
		t.Fatalf("expected web service to be present")
	}

	if len(web.Volumes) != 1 || web.Volumes[0] != "./data" {
		t.Fatalf("expected web volumes [./data], got %#v", web.Volumes)
	}
}
