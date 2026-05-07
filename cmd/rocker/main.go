package main

import (
	"fmt"
	"os"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Println("usage: rocker <up|version>")
		return
	}

	switch os.Args[1] {
	case "version":
		fmt.Println("rocker dev")
	case "up":
		fmt.Println("rocker up not yet implemented")
	default:
		fmt.Println("usage: rocker <up|version>")
	}
}
