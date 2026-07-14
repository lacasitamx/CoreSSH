package main

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"sync/atomic"

	"github.com/GehirnInc/crypt"
	_ "github.com/GehirnInc/crypt/apr1_crypt"
	_ "github.com/GehirnInc/crypt/md5_crypt"
	_ "github.com/GehirnInc/crypt/sha256_crypt"
	_ "github.com/GehirnInc/crypt/sha512_crypt"
	"github.com/openwall/yescrypt-go"
	"golang.org/x/crypto/bcrypt"
	"golang.org/x/crypto/ssh"
)

const (
	shadowFile = "/etc/shadow"
	passwdFile = "/etc/passwd"

	// minLoginUID / nobodyUID bound the accounts eligible for auto-import.
	// Regular human login accounts start at UID 1000 on Debian/Ubuntu; system
	// and service accounts (and "nobody") are excluded.
	minLoginUID = 1000
	nobodyUID   = 65534
)

var errNoSystemPassword = errors.New("account has no usable password")

// pamAuthEnabled mirrors Config.PAMAuthEnabled and is toggled live on config
// reload. Guarded atomically so passwordCallback can read it lock-free.
var pamAuthEnabled atomic.Bool

func setPAMAuthEnabled(v bool) { pamAuthEnabled.Store(v) }
func isPAMAuthEnabled() bool   { return pamAuthEnabled.Load() }

// pamLoginAndImport authenticates an unknown SSH username against the Linux
// system password and, on success, auto-imports it as a panel user. It is only
// called when server-wide PAM login is enabled. Returns nil permissions on
// success (matching the panel's other auth callbacks).
func pamLoginAndImport(username, password string) (*ssh.Permissions, error) {
	if !isRegularLoginUser(username) {
		// Not a regular human account (system/service account, root, or absent).
		return nil, fmt.Errorf("authentication failed")
	}
	if err := authenticatePAM(username, password); err != nil {
		log.Printf("PAM login failed for %s: %v", username, err)
		return nil, fmt.Errorf("authentication failed")
	}
	importPAMUser(username)
	return nil, nil
}

// importPAMUser registers a freshly PAM-authenticated account in the running
// user manager and persists it (marked use_pam) so it shows up in the panel and
// later logins are re-verified against the system password. Idempotent: a
// second concurrent/subsequent login for the same user is a no-op.
func importPAMUser(username string) {
	cfg := UserConfig{Username: username, UsePAM: true}
	st := &UserState{Cfg: cfg}
	if !userMgr.AddIfAbsent(st) {
		return // already present in memory
	}
	log.Printf("PAM: auto-imported system user %s into the panel", username)
	if statsStore != nil {
		if err := statsStore.UpsertUser(context.Background(), cfg); err != nil {
			log.Printf("PAM: failed to persist auto-imported user %s: %v", username, err)
		}
	}
}

// isRegularLoginUser reports whether username is a regular human login account
// (UID >= 1000 and not "nobody"), by parsing /etc/passwd. System/service
// accounts and root are excluded from auto-import.
func isRegularLoginUser(username string) bool {
	data, err := os.ReadFile(passwdFile)
	if err != nil {
		log.Printf("PAM: cannot read %s: %v", passwdFile, err)
		return false
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimRight(line, "\r")
		fields := strings.Split(line, ":")
		if len(fields) < 3 || fields[0] != username {
			continue
		}
		uid, err := strconv.Atoi(fields[2])
		if err != nil {
			return false
		}
		return uid >= minLoginUID && uid != nobodyUID
	}
	return false
}

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
	case isTraditionalDES(hash):
		computed, err := desCrypt(password, hash)
		if err != nil {
			return fmt.Errorf("descrypt: %w", err)
		}
		if subtle.ConstantTimeCompare([]byte(computed), []byte(hash)) == 1 {
			return nil
		}
		return errors.New("password mismatch")
	default:
		return fmt.Errorf("shadow: unsupported hash format")
	}
}

// isTraditionalDES reports whether hash looks like a classic 13-character
// DES crypt(3) hash (2 salt chars + 11 hash chars, all from the crypt alphabet,
// no "$" scheme prefix). Used by old Linux/UNIX accounts.
func isTraditionalDES(hash string) bool {
	if len(hash) != 13 {
		return false
	}
	for i := 0; i < len(hash); i++ {
		if crypt64Decode(hash[i]) < 0 {
			return false
		}
	}
	return true
}
