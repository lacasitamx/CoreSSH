package main

import (
	"testing"
	"time"
)

func TestSSHIdleTimeoutDisabledByDefault(t *testing.T) {
	for _, raw := range []string{"", "0", "0s", "off", "disabled"} {
		if got := parseSSHIdleTimeout(raw); got != 0 {
			t.Fatalf("parseSSHIdleTimeout(%q) = %s, want disabled", raw, got)
		}
	}
}

func TestSSHIdleTimeoutExplicitValue(t *testing.T) {
	if got := parseSSHIdleTimeout("30m"); got != 30*time.Minute {
		t.Fatalf("got %s, want 30m", got)
	}
}

func TestNativeXHTTPConnectedIdleSweepDisabled(t *testing.T) {
	if got := nativeXHTTPIdleTimeout(); got != 0 {
		t.Fatalf("native XHTTP idle timeout = %s, want disabled", got)
	}
}
