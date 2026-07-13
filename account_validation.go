package main

import (
	"encoding/base32"
	"fmt"
	"regexp"
	"strings"
	"time"
)

var accountUsernamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$`)

func validateAccountUsername(username string) error {
	if !accountUsernamePattern.MatchString(username) {
		return fmt.Errorf("username must be 1-64 characters using letters, numbers, dot, underscore, @, or hyphen")
	}
	return nil
}

func hasAccountControlCharacters(value string) bool {
	return strings.IndexFunc(value, func(r rune) bool { return r < 0x20 || r == 0x7f }) >= 0
}

func validateOptionalAccountExpiry(raw string) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	for _, layout := range []string{time.RFC3339, "2006-01-02T15:04", "2006-01-02"} {
		if _, err := time.Parse(layout, raw); err == nil {
			return nil
		}
	}
	return fmt.Errorf("invalid expiration date")
}

func validateSSHUserPayload(p *UserPayload) error {
	p.Username = strings.TrimSpace(p.Username)
	p.OwnerUsername = strings.TrimSpace(p.OwnerUsername)
	p.ServerID = strings.TrimSpace(p.ServerID)
	p.TOTPSecret = normalizeBase32Secret(p.TOTPSecret)
	if err := validateAccountUsername(p.Username); err != nil {
		return err
	}
	if p.Password != nil && len(*p.Password) > 4096 {
		return fmt.Errorf("password is too long")
	}
	if p.MaxConnections < 0 || p.MaxConnections > 1000 {
		return fmt.Errorf("max_connections must be between 0 and 1000")
	}
	if p.LimitUpMbps < 0 || p.LimitUpMbps > 100000 || p.LimitDownMbps < 0 || p.LimitDownMbps > 100000 {
		return fmt.Errorf("speed limits must be between 0 and 100000 Mbps")
	}
	if err := validateOptionalAccountExpiry(p.ExpiresAt); err != nil {
		return err
	}
	if p.OwnerUsername != "" {
		if err := validateAdminUsername(p.OwnerUsername); err != nil {
			return fmt.Errorf("invalid owner username")
		}
	}
	if len(p.ServerID) > 32 || hasAccountControlCharacters(p.ServerID) {
		return fmt.Errorf("invalid server id")
	}
	if p.TOTPSecret != "" {
		if len(p.TOTPSecret) > 256 {
			return fmt.Errorf("TOTP secret is too long")
		}
		if _, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(p.TOTPSecret); err != nil {
			return fmt.Errorf("invalid TOTP secret")
		}
	}
	if p.TOTPPeriod != 0 && (p.TOTPPeriod < 15 || p.TOTPPeriod > 300) {
		return fmt.Errorf("TOTP period must be between 15 and 300 seconds")
	}
	if p.TOTPWindow < 0 || p.TOTPWindow > 10 {
		return fmt.Errorf("TOTP window must be between 0 and 10")
	}
	if p.TOTPDigits != 0 && (p.TOTPDigits < 6 || p.TOTPDigits > 8) {
		return fmt.Errorf("TOTP digits must be between 6 and 8")
	}
	return nil
}

func validateXrayClientFields(uuid, inboundTag, email, name, expiresAt string, maxConnections int, requireInbound bool) error {
	uuid = strings.TrimSpace(uuid)
	if _, err := parseUUID(uuid); err != nil {
		return fmt.Errorf("invalid UUID")
	}
	if requireInbound && strings.TrimSpace(inboundTag) == "" {
		return fmt.Errorf("inbound_tag required")
	}
	for field, value := range map[string]string{
		"inbound_tag": inboundTag,
		"email":       email,
		"name":        name,
	} {
		limit := 256
		if field == "inbound_tag" {
			limit = 128
		}
		if len(value) > limit || hasAccountControlCharacters(value) {
			return fmt.Errorf("invalid %s", field)
		}
	}
	if maxConnections < 0 || maxConnections > 1000 {
		return fmt.Errorf("max_connections must be between 0 and 1000")
	}
	return validateOptionalAccountExpiry(expiresAt)
}
