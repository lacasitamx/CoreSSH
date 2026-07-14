//go:build linux && cgo

package main

import (
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/msteinert/pam/v2"
)

// pamAuthAvailable reports that PAM authentication is compiled into this build.
const pamAuthAvailable = true

// pamServiceName returns the PAM service to use for the auth-only check. This
// is the name of a file under /etc/pam.d. Override with SSHPANEL_PAM_SERVICE;
// it defaults to "login", which exists on every mainstream distro and runs the
// standard unix auth stack (common-auth / system-auth).
func pamServiceName() string {
	if s := strings.TrimSpace(os.Getenv("SSHPANEL_PAM_SERVICE")); s != "" {
		return s
	}
	return "login"
}

// authenticatePAM verifies password against the Linux PAM stack for username.
//
// It runs ONLY the auth phase (pam_authenticate) — no account management
// (pam_acct_mgmt), no session, no credential setup, and nothing to do with the
// system SSH daemon. This is the "just the auth" behaviour: the supplied
// password is checked against the system account exactly as PAM's auth modules
// would, and nothing else. Returns nil on success, an error on failure.
//
// The panel runs as root, so pam_unix can read /etc/shadow to verify the hash
// (including yescrypt/sha512crypt) for any local account.
func authenticatePAM(username, password string) error {
	if username == "" {
		return errors.New("pam: empty username")
	}
	t, err := pam.StartFunc(pamServiceName(), username, func(s pam.Style, msg string) (string, error) {
		switch s {
		case pam.PromptEchoOff, pam.PromptEchoOn:
			return password, nil
		case pam.ErrorMsg, pam.TextInfo:
			// Informational messages from modules; nothing to return.
			return "", nil
		default:
			return "", fmt.Errorf("pam: unsupported conversation style %v", s)
		}
	})
	if err != nil {
		return fmt.Errorf("pam start: %w", err)
	}
	defer func() { _ = t.End() }()

	// Silent keeps modules from writing to stdout/syslog noise; auth phase only.
	if err := t.Authenticate(pam.Silent); err != nil {
		return fmt.Errorf("pam auth: %w", err)
	}
	return nil
}
