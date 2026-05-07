package main

import (
	"bytes"
	"path/filepath"
	"os/exec"
	"testing"
)

func runRocker(t *testing.T, args ...string) ([]byte, []byte, error) {
	t.Helper()

	binPath := filepath.Join(t.TempDir(), "rocker")
	buildCmd := exec.Command("go", "build", "-o", binPath, "./cmd/rocker")
	buildCmd.Dir = "../.."
	if output, err := buildCmd.CombinedOutput(); err != nil {
		t.Fatalf("failed to build rocker binary: %v, output: %s", err, string(output))
	}

	cmd := exec.Command(binPath, args...)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	return stdout.Bytes(), stderr.Bytes(), err
}

func TestRockerVersionCommand(t *testing.T) {
	stdout, _, err := runRocker(t, "version")
	if err != nil {
		t.Fatalf("expected version command to succeed, got error: %v, output: %s", err, string(stdout))
	}
	if string(stdout) != "rocker dev\n" {
		t.Fatalf("expected exact output %q, got %q", "rocker dev\n", string(stdout))
	}
}

func TestRockerUpCommand(t *testing.T) {
	stdout, _, err := runRocker(t, "up")
	if err != nil {
		t.Fatalf("expected up command to succeed, got error: %v, output: %s", err, string(stdout))
	}
	if string(stdout) != "rocker up not yet implemented\n" {
		t.Fatalf("expected exact output %q, got %q", "rocker up not yet implemented\n", string(stdout))
	}
}

func TestRockerUsageForInvalidAndNoArgs(t *testing.T) {
	t.Run("invalid arg", func(t *testing.T) {
		stdout, stderr, err := runRocker(t, "invalid")
		if err == nil {
			t.Fatalf("expected invalid command path to fail, got nil error, output: %s", string(stdout))
		}
		if string(stdout) != "" {
			t.Fatalf("expected empty stdout, got %q", string(stdout))
		}
		if string(stderr) != "usage: rocker <up|version>\n" {
			t.Fatalf("expected exact stderr %q, got %q", "usage: rocker <up|version>\n", string(stderr))
		}
	})

	t.Run("no args", func(t *testing.T) {
		stdout, stderr, err := runRocker(t)
		if err == nil {
			t.Fatalf("expected no-args path to fail, got nil error, output: %s", string(stdout))
		}
		if string(stdout) != "" {
			t.Fatalf("expected empty stdout, got %q", string(stdout))
		}
		if string(stderr) != "usage: rocker <up|version>\n" {
			t.Fatalf("expected exact stderr %q, got %q", "usage: rocker <up|version>\n", string(stderr))
		}
	})
}
