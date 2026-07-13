package main

import "testing"

func TestValidateSSHUserPayloadBounds(t *testing.T) {
	valid := &UserPayload{
		Username:       "client-01",
		MaxConnections: 2,
		TOTPPeriod:     60,
		TOTPWindow:     1,
		TOTPDigits:     6,
	}
	if err := validateSSHUserPayload(valid); err != nil {
		t.Fatalf("valid SSH payload rejected: %v", err)
	}

	invalid := *valid
	invalid.MaxConnections = -1
	if err := validateSSHUserPayload(&invalid); err == nil {
		t.Fatal("negative max_connections was accepted")
	}

	invalid = *valid
	invalid.TOTPSecret = "not base32!"
	if err := validateSSHUserPayload(&invalid); err == nil {
		t.Fatal("invalid TOTP secret was accepted")
	}
}

func TestValidateXrayClientFields(t *testing.T) {
	const id = "d9428888-122b-11e1-b85c-61cd3cbb3210"
	if err := validateXrayClientFields(id, "vless-in", "client@example.test", "Client", "", 2, true); err != nil {
		t.Fatalf("valid Xray client rejected: %v", err)
	}
	if err := validateXrayClientFields("not-a-uuid", "vless-in", "", "", "", 1, true); err == nil {
		t.Fatal("invalid Xray UUID was accepted")
	}
	if err := validateXrayClientFields(id, "vless-in", "", "", "", 1001, true); err == nil {
		t.Fatal("excessive Xray connection limit was accepted")
	}
}

func TestCreditAccountConnectionLimitIsImmutable(t *testing.T) {
	username := "credit-limit-test"
	adminUsers.set(&AdminUser{Username: username, Role: RoleReseller, QuotaMode: QuotaModeCredit, IsActive: true})
	defer adminUsers.delete(username)

	if err := authorizeResellerQuotaChange(nil, nil, username, 2, 3); err != errCreditLimitImmutable {
		t.Fatalf("credit limit change error = %v, want %v", err, errCreditLimitImmutable)
	}
	if err := authorizeResellerQuotaChange(nil, nil, username, 2, 2); err != nil {
		t.Fatalf("unchanged credit limit rejected: %v", err)
	}
	if _, _, err := authorizeResellerProvision(nil, nil, username, "ssh:test", 0); err != errResellerConnLimit {
		t.Fatalf("zero-connection credit account error = %v, want %v", err, errResellerConnLimit)
	}
}
