package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"Rocker/internal/runtime"
)

type streamStub struct {
	errs  []error
	callN int
}

func (s *streamStub) StreamEvents(ctx context.Context) (<-chan runtime.Event, error) {
	i := s.callN
	s.callN++
	if i < len(s.errs) && s.errs[i] != nil {
		return nil, s.errs[i]
	}
	ch := make(chan runtime.Event)
	go func() {
		<-ctx.Done()
		close(ch)
	}()
	return ch, nil
}

func TestEventStreamReconnectsAfterTemporaryFailures(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	stub := &streamStub{errs: []error{errors.New("docker down"), errors.New("still down"), nil}}
	result := make(chan error, 1)

	go func() {
		result <- StartEventStreamWithRetry(ctx, stub, 2*time.Millisecond)
	}()

	time.Sleep(12 * time.Millisecond)
	cancel()

	if err := <-result; err != nil {
		t.Fatalf("expected reconnect loop to stop cleanly on cancel, got %v", err)
	}

	if stub.callN < 3 {
		t.Fatalf("expected at least 3 stream attempts, got %d", stub.callN)
	}
}
