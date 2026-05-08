SHELL := /bin/bash

.PHONY: help test ui-build build run

help:
	@printf "Available targets:\n"
	@printf "  make test      - run Go tests\n"
	@printf "  make ui-build  - install and build web UI\n"
	@printf "  make build     - build rocker binary\n"
	@printf "  make run       - run rocker with compose file\n"

test:
	go test ./...

ui-build:
	npm --prefix web install
	npm --prefix web run build
	mkdir -p internal/uiassets/dist
	cp -r web/dist/. internal/uiassets/dist/

build:
	go build -o rocker ./cmd/rocker

run:
	go run ./cmd/rocker up --compose ./fixtures/compose-4svc.yml
