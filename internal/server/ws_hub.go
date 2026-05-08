package server

import "Rocker/internal/domain"

type WSMessage struct {
	Kind     string                  `json:"kind"`
	Snapshot domain.AppGraphSnapshot `json:"snapshot"`
}

type WSHub struct {
	clients []chan WSMessage
}

func NewWSHub() *WSHub {
	return &WSHub{clients: make([]chan WSMessage, 0)}
}

func (h *WSHub) Subscribe() <-chan WSMessage {
	ch := make(chan WSMessage, 1)
	h.clients = append(h.clients, ch)
	return ch
}

func (h *WSHub) BroadcastSnapshotInit(snapshot domain.AppGraphSnapshot) {
	msg := WSMessage{Kind: "snapshot.init", Snapshot: snapshot}
	for _, client := range h.clients {
		select {
		case client <- msg:
		default:
		}
	}
}
