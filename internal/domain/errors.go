package domain

import "fmt"

const (
	ErrCodeComposeInvalid        = "COMPOSE_INVALID"
	ErrCodeDockerUnreachable     = "DOCKER_UNREACHABLE"
	ErrCodeCgroupUnavailable     = "CGROUP_UNAVAILABLE"
	ErrCodeInsufficientPermission = "INSUFFICIENT_PERMISSION"
)

type AppError struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
}

func (e AppError) Error() string {
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

func NewAppError(code, message string, retryable bool) AppError {
	return AppError{Code: code, Message: message, Retryable: retryable}
}
