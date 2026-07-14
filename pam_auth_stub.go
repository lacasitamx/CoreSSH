//go:build !linux || !cgo

package main

import "errors"

// pamAuthAvailable is false when the binary is built without cgo/PAM support
// (for example the Windows development build, or any CGO_ENABLED=0 build).
// In that case a user flagged for PAM auth can never authenticate.
const pamAuthAvailable = false

func pamServiceName() string { return "" }

func authenticatePAM(username, password string) error {
	return errors.New("pam authentication is not supported in this build")
}
