package main

import "runtime/debug"

// xrayRecover prevents a bad client packet, closed HTTP stream, or mux/session
// race from taking down the whole sshpanel process. A panic should only kill the
// current native Xray connection/session and must always leave a visible stack
// trace in /api/xray/logs and journald.
func xrayRecover(where string) {
	if r := recover(); r != nil {
		xrayLogf("native xray: panic recovered in %s: %v\n%s", where, r, debug.Stack())
	}
}

func xrayGo(where string, fn func()) {
	go func() {
		defer xrayRecover(where)
		fn()
	}()
}
