package main

import (
	"path/filepath"
	"os/exec"
	"testing"
)

func runRocker(t *testing.T, args ...string) ([]byte, error) {
	t.Helper()

	binPath := filepath.Join(t.TempDir(), "rocker")
	buildCmd := exec.Command("go", "build", "-o", binPath, "./cmd/rocker")
	buildCmd.Dir = "../.."
	if output, err := buildCmd.CombinedOutput(); err != nil {
		t.Fatalf("failed to build rocker binary: %v, output: %s", err, string(output))
	}

	cmd := exec.Command(binPath, args...)
	return cmd.CombinedOutput()
}

func TestRockerVersionCommand(t *testing.T) {
	output, err := runRocker(t, "version")
	if err != nil {
		t.Fatalf("expected version command to succeed, got error: %v, output: %s", err, string(output))
	}
	if string(output) != "rocker dev\n" {
		t.Fatalf("expected exact output %q, got %q", "rocker dev\n", string(output))
	}
}

func TestRockerUpCommand(t *testing.T) {
	output, err := runRocker(t, "up")
	if err != nil {
		t.Fatalf("expected up command to succeed, got error: %v, output: %s", err, string(output))
	}
	if string(output) != "rocker up not yet implemented\n" {
		t.Fatalf("expected exact output %q, got %q", "rocker up not yet implemented\n", string(output))
	}
}

func TestRockerUsageForInvalidAndNoArgs(t *testing.T) {
	t.Run("invalid arg", func(t *testing.T) {
		output, err := runRocker(t, "invalid")
		if err == nil {
			t.Fatalf("expected invalid command path to fail, got nil error, output: %s", string(output))
		}
		if string(output) != "usage: rocker <up|version>\n" {
			t.Fatalf("expected exact output %q, got %q", "usage: rocker <up|version>\n", string(output))
		}
	})

	t.Run("no args", func(t *testing.T) {
		output, err := runRocker(t)
		if err == nil {
			t.Fatalf("expected no-args path to fail, got nil error, output: %s", string(output))
		}
		if string(output) != "usage: rocker <up|version>\n" {
			t.Fatalf("expected exact output %q, got %q", "usage: rocker <up|version>\n", string(output))
		}
	})
}
