package app

import (
	"context"
	"errors"
	"time"

	"Rocker/internal/runtime"
)

var ErrComposeRequired = errors.New("--compose is required")

type UpUseCase struct{}

func NewUpUseCase() *UpUseCase {
	return &UpUseCase{}
}

func (u *UpUseCase) Run(composePath string) error {
	if composePath == "" {
		return ErrComposeRequired
	}
	return nil
}

type EventStreamer interface {
	StreamEvents(ctx context.Context) (<-chan runtime.Event, error)
}

func StartEventStreamWithRetry(ctx context.Context, streamer EventStreamer, backoff time.Duration) error {
	if backoff <= 0 {
		backoff = 300 * time.Millisecond
	}

	for {
		if ctx.Err() != nil {
			return nil
		}

		events, err := streamer.StreamEvents(ctx)
		if err != nil {
			select {
			case <-ctx.Done():
				return nil
			case <-time.After(backoff):
				continue
			}
		}

		for range events {
		}

		select {
		case <-ctx.Done():
			return nil
		case <-time.After(backoff):
		}
	}
}
