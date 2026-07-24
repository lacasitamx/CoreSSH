package main

import "testing"

func TestNormalizeDNSTTListenDefault(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		want     string
		migrated bool
	}{
		{name: "empty uses IPv4 default", input: "", want: "0.0.0.0:5300"},
		{name: "whitespace uses IPv4 default", input: "  ", want: "0.0.0.0:5300"},
		{name: "legacy IPv6 wildcard migrates", input: "[::]:5300", want: "0.0.0.0:5300", migrated: true},
		{name: "expanded legacy wildcard migrates", input: "[0:0:0:0:0:0:0:0]:5300", want: "0.0.0.0:5300", migrated: true},
		{name: "explicit IPv4 remains", input: "192.0.2.10:53", want: "192.0.2.10:53"},
		{name: "IPv4 wildcard remains", input: "0.0.0.0:5300", want: "0.0.0.0:5300"},
		{name: "concrete IPv6 remains", input: "[2001:db8::10]:53", want: "[2001:db8::10]:53"},
		{name: "IPv6 wildcard on custom port remains", input: "[::]:5301", want: "[::]:5301"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, migrated := normalizeDNSTTListenDefault(tt.input)
			if got != tt.want || migrated != tt.migrated {
				t.Fatalf("normalizeDNSTTListenDefault(%q) = (%q, %v), want (%q, %v)", tt.input, got, migrated, tt.want, tt.migrated)
			}
		})
	}
}
