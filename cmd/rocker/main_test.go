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
}
