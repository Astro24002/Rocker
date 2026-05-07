package main

import (
	"fmt"
	"os"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: rocker <up|version>")
		os.Exit(2)
	}

	switch os.Args[1] {
	case "version":
		fmt.Println("rocker dev")
	case "up":
		fmt.Println("rocker up not yet implemented")
	default:
		fmt.Fprintln(os.Stderr, "usage: rocker <up|version>")
		os.Exit(2)
	}
}
