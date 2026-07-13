package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"testing"
	"time"
)

func TestAdminPasswordHashAndLegacyUpgrade(t *testing.T) {
	password := "correct-horse-battery-staple"
	hash, err := hashAdminPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	if valid, upgrade := verifyAdminPassword(hash, password); !valid || upgrade {
		t.Fatalf("bcrypt verification = valid %v, upgrade %v", valid, upgrade)
	}
	if valid, _ := verifyAdminPassword(hash, "wrong-password"); valid {
		t.Fatal("wrong bcrypt password was accepted")
	}
	legacy := legacyAdminPasswordHash(password)
	if valid, upgrade := verifyAdminPassword(legacy, password); !valid || !upgrade {
		t.Fatalf("legacy verification = valid %v, upgrade %v", valid, upgrade)
	}
}

func TestTLSDomainRejectsTraversal(t *testing.T) {
	for _, value := range []string{"../root", `..\\root`, "/absolute", "host\nname"} {
		if _, _, err := normalizeTLSDomain(value, true); err == nil {
			t.Fatalf("normalizeTLSDomain(%q) accepted unsafe value", value)
		}
	}
	if domain, _, err := normalizeTLSDomain("vpn.example.com", false); err != nil || domain != "vpn.example.com" {
		t.Fatalf("valid domain rejected: %q, %v", domain, err)
	}
}

func TestManagedServerURLValidation(t *testing.T) {
	for _, value := range []string{
		"ftp://example.com", "https://user:pass@example.com", "https://example.com/admin", "http://169.254.10.20",
	} {
		if _, err := validateManagedServerBaseURL(value); err == nil {
			t.Fatalf("validateManagedServerBaseURL(%q) accepted unsafe value", value)
		}
	}
	if got, err := validateManagedServerBaseURL("https://node.example.com/"); err != nil || got != "https://node.example.com" {
		t.Fatalf("valid managed server URL = %q, %v", got, err)
	}
}

func TestRemoteErrorSnippetIsBoundedAndSingleLine(t *testing.T) {
	input := make([]byte, 5000)
	for i := range input {
		input[i] = 'x'
	}
	copy(input, []byte("first\nsecond\r\tsecret"))
	got := remoteErrorSnippet(input)
	if len(got) > 4100 {
		t.Fatalf("remote error snippet is too long: %d", len(got))
	}
	for _, r := range got {
		if r < 0x20 || r == 0x7f {
			t.Fatalf("remote error snippet retained control character %q", r)
		}
	}
}

func TestMPSignatureRequiresSecretAndValidHMAC(t *testing.T) {
	const (
		secret    = "test-secret-with-enough-entropy"
		dataID    = "123456789"
		requestID = "request-123"
	)
	ts := time.Now().Format("150405")
	manifest := "id:" + dataID + ";request-id:" + requestID + ";ts:" + ts + ";"
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(manifest))
	signature := "ts=" + ts + ",v1=" + hex.EncodeToString(mac.Sum(nil))
	if !verifyMPSignature(signature, requestID, dataID, secret) {
		t.Fatal("valid Mercado Pago signature was rejected")
	}
	if verifyMPSignature(signature, requestID, dataID, "") {
		t.Fatal("unsigned webhook mode was accepted")
	}
	if verifyMPSignature(signature, requestID, dataID, "wrong-secret") {
		t.Fatal("signature with wrong secret was accepted")
	}
}
