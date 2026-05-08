package main

import (
	"fmt"
	"os"

	"Rocker/internal/app"
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
		runtime := app.Bootstrap()
		composePath := ""
		for i := 2; i < len(os.Args); i++ {
			if os.Args[i] == "--compose" && i+1 < len(os.Args) {
				composePath = os.Args[i+1]
				i++
			}
		}

		if err := runtime.Up.Run(composePath); err != nil {
			fmt.Fprintf(os.Stderr, "error: %s\n", err.Error())
			os.Exit(2)
		}

		fmt.Println("rocker up started")
	default:
		fmt.Fprintln(os.Stderr, "usage: rocker <up|version>")
		os.Exit(2)
	}
}
