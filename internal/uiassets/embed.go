package uiassets

import "embed"

//go:embed dist/* dist/assets/*
var DistFS embed.FS
