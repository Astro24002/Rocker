package main

import (
	"os/exec"
	"testing"
)

func TestRockerVersionCommand(t *testing.T) {
	cmd := exec.Command("go", "run", "./cmd/rocker", "version")
	cmd.Dir = "../.."
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("expected version command to succeed, got error: %v, output: %s", err, string(output))
	}
	if string(output) != "rocker dev\n" {
		t.Fatalf("expected exact output %q, got %q", "rocker dev\n", string(output))
	}
}

func TestRockerUpCommand(t *testing.T) {
	cmd := exec.Command("go", "run", "./cmd/rocker", "up")
	cmd.Dir = "../.."
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("expected up command to succeed, got error: %v, output: %s", err, string(output))
	}
	if string(output) != "rocker up not yet implemented\n" {
		t.Fatalf("expected exact output %q, got %q", "rocker up not yet implemented\n", string(output))
	}
}

func TestRockerUsageForInvalidAndNoArgs(t *testing.T) {
	t.Run("invalid arg", func(t *testing.T) {
		cmd := exec.Command("go", "run", "./cmd/rocker", "invalid")
		cmd.Dir = "../.."
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("expected invalid command path to succeed, got error: %v, output: %s", err, string(output))
		}
		if string(output) != "usage: rocker <up|version>\n" {
			t.Fatalf("expected exact output %q, got %q", "usage: rocker <up|version>\n", string(output))
		}
	})

	t.Run("no args", func(t *testing.T) {
		cmd := exec.Command("go", "run", "./cmd/rocker")
		cmd.Dir = "../.."
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("expected no-args path to succeed, got error: %v, output: %s", err, string(output))
		}
		if string(output) != "usage: rocker <up|version>\n" {
			t.Fatalf("expected exact output %q, got %q", "usage: rocker <up|version>\n", string(output))
		}
	})
}
