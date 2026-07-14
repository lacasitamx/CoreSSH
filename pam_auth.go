package main

import (
	"crypto/subtle"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/GehirnInc/crypt"
	_ "github.com/GehirnInc/crypt/apr1_crypt"
	_ "github.com/GehirnInc/crypt/md5_crypt"
	_ "github.com/GehirnInc/crypt/sha256_crypt"
	_ "github.com/GehirnInc/crypt/sha512_crypt"
	"github.com/openwall/yescrypt-go"
	"golang.org/x/crypto/bcrypt"
)

// pamAuthAvailable reports that system-password ("PAM") auth is compiled in.
// The implementation is pure Go (no cgo, no libpam), so it is always available;
// on non-Linux builds /etc/shadow simply does not exist and auth fails closed.
const pamAuthAvailable = true

const shadowFile = "/etc/shadow"

var errNoSystemPassword = errors.New("account has no usable password")

// authenticatePAM verifies password against the Linux system account matching
// username. It reads the account's hash from /etc/shadow (the panel runs as
// root) and recomputes it with the same algorithm — this is the "just the auth"
// behaviour: the supplied password is checked exactly as the system would,
// with no account/session management and nothing to do with the SSH daemon.
//
// It is called "PAM" for continuity with the user-facing flag, but it does not
// link libpam; it verifies the crypt(3) hash directly. Supported hash formats:
// yescrypt ($y$), sha512-crypt ($6$), sha256-crypt ($5$), md5-crypt ($1$),
// apr1 ($apr1$) and bcrypt ($2a$/$2b$/$2y$). Returns nil on success.
func authenticatePAM(username, password string) error {
	if username == "" {
		return errors.New("shadow: empty username")
	}
	hash, err := lookupShadowHash(username)
	if err != nil {
		return err
	}
	return verifyCryptHash(hash, password)
}

// lookupShadowHash returns the password hash field for username from /etc/shadow.
func lookupShadowHash(username string) (string, error) {
	data, err := os.ReadFile(shadowFile)
	if err != nil {
		return "", fmt.Errorf("read %s: %w", shadowFile, err)
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimRight(line, "\r")
		if line == "" {
			continue
		}
		fields := strings.Split(line, ":")
		if len(fields) < 2 || fields[0] != username {
			continue
		}
		hash := fields[1]
		// Empty, or locked/disabled accounts (! or * in the hash field) have no
		// password that any input can match — reject rather than risk a match.
		if hash == "" || strings.HasPrefix(hash, "!") || strings.HasPrefix(hash, "*") {
			return "", errNoSystemPassword
		}
		return hash, nil
	}
	return "", fmt.Errorf("shadow: user %q not found", username)
}

// verifyCryptHash checks password against a crypt(3)-style hash string,
// dispatching on the hash prefix. Returns nil only on an exact match.
func verifyCryptHash(hash, password string) error {
	switch {
	case strings.HasPrefix(hash, "$y$"):
		computed, err := yescrypt.Hash([]byte(password), []byte(hash))
		if err != nil {
			return fmt.Errorf("yescrypt: %w", err)
		}
		if subtle.ConstantTimeCompare(computed, []byte(hash)) == 1 {
			return nil
		}
		return errors.New("password mismatch")
	case strings.HasPrefix(hash, "$2a$"), strings.HasPrefix(hash, "$2b$"), strings.HasPrefix(hash, "$2y$"):
		return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	case crypt.IsHashSupported(hash):
		return crypt.NewFromHash(hash).Verify(hash, []byte(password))
	default:
		return fmt.Errorf("shadow: unsupported hash format")
	}
}
