package app

type Runtime struct {
	Up *UpUseCase
}

func Bootstrap() Runtime {
	return Runtime{Up: NewUpUseCase()}
}
