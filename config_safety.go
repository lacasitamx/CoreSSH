package main

import (
	"fmt"
	"log"
	"net"
	"strings"
)

const (
	defaultMainListen  = "0.0.0.0:80"
	defaultExtraListen = "0.0.0.0:8080"
	defaultDNSTTListen = "[::]:5300"
	defaultUDPGWListen = "0.0.0.0:7400"
)

func normalizeRuntimePorts(cfg *Config) []string {
	var warnings []string
	warn := func(format string, args ...interface{}) {
		msg := fmt.Sprintf(format, args...)
		warnings = append(warnings, msg)
		log.Printf("config safety: %s", msg)
	}

	cfg.Listen = strings.TrimSpace(cfg.Listen)
	if cfg.Listen == "" {
		cfg.Listen = defaultMainListen
	}
	if err := tcpAddrAvailableForPool(cfg.Listen, publicPool); err != nil {
		old := cfg.Listen
		cfg.Listen = defaultMainListen
		warn("main listener %s is unavailable (%v); using default %s", old, err, cfg.Listen)
		if err2 := tcpAddrAvailableForPool(cfg.Listen, publicPool); err2 != nil {
			warn("default main listener %s is also unavailable: %v", cfg.Listen, err2)
		}
	}

	seen := map[string]bool{cfg.Listen: true}
	extra := make([]string, 0, len(cfg.ExtraListen))
	for _, addr := range cfg.ExtraListen {
		addr = strings.TrimSpace(addr)
		if addr == "" || seen[addr] {
			continue
		}
		if err := tcpAddrAvailableForPool(addr, publicPool); err != nil {
			warn("extra listener %s is unavailable (%v)", addr, err)
			fallback := defaultExtraListen
			if !seen[fallback] {
				if err2 := tcpAddrAvailableForPool(fallback, publicPool); err2 == nil {
					extra = append(extra, fallback)
					seen[fallback] = true
					warn("extra listener fell back to default %s", fallback)
				} else {
					warn("default extra listener %s is also unavailable: %v", fallback, err2)
				}
			}
			continue
		}
		extra = append(extra, addr)
		seen[addr] = true
	}
	cfg.ExtraListen = extra

	// DragonCore no longer uses an internal local SSH listener.
	cfg.LocalSSHListen = ""

	if cfg.DNSTT != nil {
		cfg.DNSTT.UDPListen = strings.TrimSpace(cfg.DNSTT.UDPListen)
		if cfg.DNSTT.UDPListen == "" {
			cfg.DNSTT.UDPListen = defaultDNSTTListen
		}
		if err := udpAddrAvailableForDNSTT(cfg.DNSTT.UDPListen); err != nil {
			old := cfg.DNSTT.UDPListen
			cfg.DNSTT.UDPListen = defaultDNSTTListen
			warn("DNSTT UDP listener %s is unavailable (%v); using default %s", old, err, cfg.DNSTT.UDPListen)
			if err2 := udpAddrAvailableForDNSTT(cfg.DNSTT.UDPListen); err2 != nil {
				warn("default DNSTT UDP listener %s is also unavailable: %v", cfg.DNSTT.UDPListen, err2)
			}
		}
	}

	if cfg.UDPGW != nil {
		cfg.UDPGW.Listen = strings.TrimSpace(cfg.UDPGW.Listen)
		if cfg.UDPGW.Listen == "" {
			cfg.UDPGW.Listen = defaultUDPGWListen
		}
		if err := tcpAddrAvailableForUDPGW(cfg.UDPGW.Listen); err != nil {
			old := cfg.UDPGW.Listen
			cfg.UDPGW.Listen = defaultUDPGWListen
			warn("UDPGW listener %s is unavailable (%v); using default %s", old, err, cfg.UDPGW.Listen)
			if err2 := tcpAddrAvailableForUDPGW(cfg.UDPGW.Listen); err2 != nil {
				warn("default UDPGW listener %s is also unavailable: %v", cfg.UDPGW.Listen, err2)
			}
		}
	}

	return warnings
}

func tcpAddrAvailableForPool(addr string, pool *listenerPool) error {
	if addr == "" {
		return nil
	}
	if pool != nil && pool.Has(addr) {
		return nil
	}
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	return ln.Close()
}

func tcpAddrAvailableForUDPGW(addr string) error {
	if addr == "" {
		return nil
	}
	globalCfgMu.RLock()
	current := globalCfg != nil && globalCfg.UDPGW != nil && globalCfg.UDPGW.Listen == addr && udpgwRunning()
	globalCfgMu.RUnlock()
	if current {
		return nil
	}
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	return ln.Close()
}

func udpAddrAvailableForDNSTT(addr string) error {
	if addr == "" {
		return nil
	}
	globalCfgMu.RLock()
	current := globalCfg != nil && globalCfg.DNSTT != nil && globalCfg.DNSTT.UDPListen == addr && dnsttRunning()
	globalCfgMu.RUnlock()
	if current {
		return nil
	}
	pc, err := net.ListenPacket("udp", addr)
	if err != nil {
		return err
	}
	return pc.Close()
}
